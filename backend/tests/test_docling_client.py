import email
from io import BytesIO

import httpx
import pytest
from pypdf import PdfReader, PdfWriter

from app.services.docling_client import (
    PDFConversionError,
    RemoteDoclingHtmlExtractor,
    get_html_extractor,
)

# ADR-014/016: backend側はDoclingを直接呼ばず、docling-serviceへHTTPで委譲する。Doclingが担うのは
# 単独のHTMLエンジンとしてのテキスト抽出のみで、レイアウトHTML（PyMuPDF由来）とは別物。
# 実際のDocling変換の正しさはdocling-service/tests/test_converter.pyで検証済みのため、
# ここではhttpx.MockTransportでHTTP呼び出しの配線（リクエスト形状・エラーマッピング）のみを検証する。


def _client_with(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _build_multi_page_pdf(page_widths: list) -> bytes:
    # ページごとにmediaboxの幅を変えることで、どのページが送信されたかを識別できるようにする。
    writer = PdfWriter()
    for width in page_widths:
        writer.add_blank_page(width=width, height=300)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _extract_uploaded_file_bytes(request: httpx.Request) -> bytes:
    # httpxのmultipart/form-dataボディはemail.message互換の形式のため、Content-Typeヘッダー
    # （boundary情報を含む）を先頭に付与した上でemailパーサーに渡し、"file"パートの本体を取り出す。
    content_type = request.headers["content-type"]
    raw = f"Content-Type: {content_type}\r\n\r\n".encode() + request.content
    message = email.message_from_bytes(raw)
    for part in message.get_payload():
        if part.get_param("name", header="Content-Disposition") == "file":
            return part.get_payload(decode=True)
    raise AssertionError("multipartリクエストにfileパートが見つからない")


def test_remote_extractor_returns_html_on_success():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/convert"
        assert b'filename="sample.pdf"' in request.content
        return httpx.Response(200, json={"html": "<html>converted-html-marker</html>"})

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    html = extractor.convert_to_html("sample.pdf", b"pdf-bytes")

    assert html == "<html>converted-html-marker</html>"


def test_remote_extractor_raises_pdf_conversion_error_on_non_200():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"detail": "PDFの解析に失敗しました（テスト用）"})

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    with pytest.raises(PDFConversionError):
        extractor.convert_to_html("broken.pdf", b"not a real pdf content at all")


def test_remote_extractor_raises_pdf_conversion_error_on_connection_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    with pytest.raises(PDFConversionError):
        extractor.convert_to_html("sample.pdf", b"pdf-bytes")


def test_remote_extractor_uses_docling_service_url_env(monkeypatch):
    # docker-compose.ymlが設定するDOCLING_SERVICE_URLをbase_url未指定時の既定値として使うことを検証する。
    monkeypatch.setenv("DOCLING_SERVICE_URL", "http://custom-docling-host:9999")
    requested_urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        return httpx.Response(200, json={"html": "<html>x</html>"})

    extractor = RemoteDoclingHtmlExtractor(client=_client_with(handler))
    extractor.convert_to_html("f.pdf", b"x")

    assert requested_urls == ["http://custom-docling-host:9999/convert"]


def test_get_html_extractor_returns_remote_extractor():
    # main.pyのDependsから差し替え可能にするためのファクトリ契約を検証する。
    assert isinstance(get_html_extractor(), RemoteDoclingHtmlExtractor)


def test_remote_extractor_sends_only_first_page_of_multi_page_pdf():
    # adapt-sheetの帳票テンプレートは1ページ完結が前提のため、Doclingへの解析リクエスト（＝処理時間・
    # コスト）を1ページ目分に抑える（ADR-015）。
    multi_page_pdf = _build_multi_page_pdf([200, 300, 400])
    sent_page_widths = []

    def handler(request: httpx.Request) -> httpx.Response:
        uploaded = _extract_uploaded_file_bytes(request)
        reader = PdfReader(BytesIO(uploaded))
        sent_page_widths.extend(float(page.mediabox.width) for page in reader.pages)
        return httpx.Response(200, json={"html": "<html>x</html>"})

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    extractor.convert_to_html("multi.pdf", multi_page_pdf)

    # 1ページ目（幅200）のみが送信され、2・3ページ目（幅300/400）は破棄されていること。
    assert sent_page_widths == [200.0]


def test_remote_extractor_passes_through_content_unchanged_for_single_page_pdf():
    single_page_pdf = _build_multi_page_pdf([200])

    def handler(request: httpx.Request) -> httpx.Response:
        uploaded = _extract_uploaded_file_bytes(request)
        reader = PdfReader(BytesIO(uploaded))
        assert len(reader.pages) == 1
        assert float(reader.pages[0].mediabox.width) == 200.0
        return httpx.Response(200, json={"html": "<html>x</html>"})

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    extractor.convert_to_html("single.pdf", single_page_pdf)


def test_remote_extractor_falls_back_to_original_bytes_when_not_a_valid_pdf():
    # 不正なPDF（壊れている等）の切り詰めはdocling-service側の既存エラーハンドリング
    # （422へのマッピング）に委ねるため、ページ抽出に失敗した場合は元のバイト列をそのまま送る。
    invalid_content = b"not a real pdf content at all"

    def handler(request: httpx.Request) -> httpx.Response:
        assert _extract_uploaded_file_bytes(request) == invalid_content
        return httpx.Response(422, json={"detail": "PDFの解析に失敗しました（テスト用）"})

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    with pytest.raises(PDFConversionError):
        extractor.convert_to_html("broken.pdf", invalid_content)
