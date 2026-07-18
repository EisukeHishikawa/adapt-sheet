from io import BytesIO

import httpx
import pytest
from pypdf import PdfReader

from app.services.docling_client import (
    PDFConversionError,
    RemoteDoclingHtmlExtractor,
    get_html_extractor,
)
from tests._pdf_test_helpers import (
    build_multi_page_pdf as _build_multi_page_pdf,
    client_with as _client_with,
    extract_uploaded_file_bytes as _extract_uploaded_file_bytes,
)

# ADR-013/016: backend側はDoclingを直接呼ばず、docling-serviceへHTTPで委譲する。Doclingが担うのは
# 単独のHTMLエンジンとしてのテキスト抽出のみで、レイアウトHTML（PyMuPDF由来）とは別物。
# 実際のDocling変換の正しさはdocling-service/tests/test_converter.pyで検証済みのため、
# ここではhttpx.MockTransportでHTTP呼び出しの配線（リクエスト形状・エラーマッピング）のみを検証する。


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
    # コスト）を1ページ目分に抑える（ADR-014）。first_page_only自体の切り詰め・フォールバック
    # ロジックはtest_pdf_common.pyで純粋関数として直接検証済みのため、ここでは
    # convert_to_htmlが実際にfirst_page_onlyを経由して送信する配線のみを確認する。
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
