import email
from io import BytesIO

import httpx
import pytest
from pypdf import PdfReader, PdfWriter

from app.services.pdf2htmlex_client import (
    PDFConversionError,
    RemotePdf2htmlEXConverter,
    get_layout_converter,
)

# ADR-023: レイアウト（見た目）を保持したHTMLはpdf2htmlex-serviceへHTTPで委譲する。
# 実際の変換の正しさはpdf2htmlex-service/tests/test_converter.pyで検証済みのため、ここでは
# httpx.MockTransportでHTTP呼び出しの配線（リクエスト形状・エラーマッピング）のみを検証する。


def _client_with(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _build_multi_page_pdf(page_widths: list) -> bytes:
    writer = PdfWriter()
    for width in page_widths:
        writer.add_blank_page(width=width, height=300)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _extract_uploaded_file_bytes(request: httpx.Request) -> bytes:
    content_type = request.headers["content-type"]
    raw = f"Content-Type: {content_type}\r\n\r\n".encode() + request.content
    message = email.message_from_bytes(raw)
    for part in message.get_payload():
        if part.get_param("name", header="Content-Disposition") == "file":
            return part.get_payload(decode=True)
    raise AssertionError("multipartリクエストにfileパートが見つからない")


def test_remote_converter_returns_html_on_success():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/convert"
        assert b'filename="sample.pdf"' in request.content
        return httpx.Response(200, json={"html": "<html><body>layout-marker</body></html>"})

    converter = RemotePdf2htmlEXConverter(
        base_url="http://pdf2htmlex:8200", client=_client_with(handler)
    )

    html = converter.convert_to_html("sample.pdf", b"pdf-bytes")

    assert html == "<html><body>layout-marker</body></html>"


def test_remote_converter_raises_pdf_conversion_error_on_non_200():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"detail": "PDFの解析に失敗しました（テスト用）"})

    converter = RemotePdf2htmlEXConverter(
        base_url="http://pdf2htmlex:8200", client=_client_with(handler)
    )

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"not a real pdf content at all")


def test_remote_converter_raises_pdf_conversion_error_on_connection_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    converter = RemotePdf2htmlEXConverter(
        base_url="http://pdf2htmlex:8200", client=_client_with(handler)
    )

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("sample.pdf", b"pdf-bytes")


def test_remote_converter_uses_pdf2htmlex_service_url_env(monkeypatch):
    monkeypatch.setenv("PDF2HTMLEX_SERVICE_URL", "http://custom-pdf2htmlex-host:9999")
    requested_urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        return httpx.Response(200, json={"html": "<html></html>"})

    converter = RemotePdf2htmlEXConverter(client=_client_with(handler))
    converter.convert_to_html("f.pdf", b"x")

    assert requested_urls == ["http://custom-pdf2htmlex-host:9999/convert"]


def test_get_layout_converter_returns_remote_converter():
    assert isinstance(get_layout_converter(), RemotePdf2htmlEXConverter)


def test_remote_converter_sends_only_first_page_of_multi_page_pdf():
    # Docling側と同じく1ページ目のみを送る（ADR-021）。
    multi_page_pdf = _build_multi_page_pdf([200, 300])
    sent_page_widths = []

    def handler(request: httpx.Request) -> httpx.Response:
        uploaded = _extract_uploaded_file_bytes(request)
        reader = PdfReader(BytesIO(uploaded))
        sent_page_widths.extend(float(page.mediabox.width) for page in reader.pages)
        return httpx.Response(200, json={"html": "<html></html>"})

    converter = RemotePdf2htmlEXConverter(
        base_url="http://pdf2htmlex:8200", client=_client_with(handler)
    )

    converter.convert_to_html("multi.pdf", multi_page_pdf)

    assert sent_page_widths == [200.0]
