from io import BytesIO

import httpx
import pytest
from pypdf import PdfReader

from app.services.pdf2htmlex_client import (
    PDFConversionError,
    RemotePdf2HtmlExExtractor,
    get_pdf2htmlex_extractor,
)
from tests._pdf_test_helpers import (
    build_multi_page_pdf as _build_multi_page_pdf,
    client_with as _client_with,
    extract_uploaded_file_bytes as _extract_uploaded_file_bytes,
)

# ADR-015: backend側はpdf2htmlEXを直接呼ばず、pdf2htmlex-serviceへHTTPで委譲する
# （docling_clientと同じ分離方針）。ここではhttpx.MockTransportでHTTP呼び出しの配線
# （リクエスト形状・エラーマッピング）のみを検証する。


def test_remote_extractor_returns_html_on_success():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/convert"
        assert b'filename="sample.pdf"' in request.content
        return httpx.Response(200, json={"html": "<html>pdf2htmlex-marker</html>"})

    extractor = RemotePdf2HtmlExExtractor(
        base_url="http://pdf2htmlex:8200", client=_client_with(handler)
    )

    html = extractor.convert_to_html("sample.pdf", b"pdf-bytes")

    assert html == "<html>pdf2htmlex-marker</html>"


def test_remote_extractor_raises_pdf_conversion_error_on_non_200():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"detail": "PDFの解析に失敗しました（テスト用）"})

    extractor = RemotePdf2HtmlExExtractor(
        base_url="http://pdf2htmlex:8200", client=_client_with(handler)
    )

    with pytest.raises(PDFConversionError):
        extractor.convert_to_html("broken.pdf", b"not a real pdf content at all")


def test_remote_extractor_raises_pdf_conversion_error_on_connection_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    extractor = RemotePdf2HtmlExExtractor(
        base_url="http://pdf2htmlex:8200", client=_client_with(handler)
    )

    with pytest.raises(PDFConversionError):
        extractor.convert_to_html("sample.pdf", b"pdf-bytes")


def test_remote_extractor_uses_service_url_env(monkeypatch):
    # docker-compose.ymlが設定するPDF2HTMLEX_SERVICE_URLをbase_url未指定時の既定値として使う。
    monkeypatch.setenv("PDF2HTMLEX_SERVICE_URL", "http://custom-pdf2htmlex-host:9999")
    requested_urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        return httpx.Response(200, json={"html": "<html>x</html>"})

    extractor = RemotePdf2HtmlExExtractor(client=_client_with(handler))
    extractor.convert_to_html("f.pdf", b"x")

    assert requested_urls == ["http://custom-pdf2htmlex-host:9999/convert"]


def test_get_pdf2htmlex_extractor_returns_remote_extractor():
    assert isinstance(get_pdf2htmlex_extractor(), RemotePdf2HtmlExExtractor)


def test_remote_extractor_sends_only_first_page_of_multi_page_pdf():
    # adapt-sheetの帳票テンプレートは1ページ完結が前提のため、pdf2htmlex-serviceへの
    # 変換リクエストを1ページ目分に抑える（docling_client・ADR-014と同じ方針）。
    multi_page_pdf = _build_multi_page_pdf([200, 300, 400])
    sent_page_widths = []

    def handler(request: httpx.Request) -> httpx.Response:
        uploaded = _extract_uploaded_file_bytes(request)
        reader = PdfReader(BytesIO(uploaded))
        sent_page_widths.extend(float(page.mediabox.width) for page in reader.pages)
        return httpx.Response(200, json={"html": "<html>x</html>"})

    extractor = RemotePdf2HtmlExExtractor(
        base_url="http://pdf2htmlex:8200", client=_client_with(handler)
    )

    extractor.convert_to_html("multi.pdf", multi_page_pdf)

    assert sent_page_widths == [200.0]
