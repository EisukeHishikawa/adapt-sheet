import httpx
import pytest

from app.services.docling_client import (
    PDFConversionError,
    RemoteDoclingPDFConverter,
    get_pdf_converter,
)

# ADR-018: backend側はDoclingを直接呼ばず、docling-serviceへHTTPで委譲する。
# 実際のDocling変換の正しさはdocling-service/tests/test_converter.pyで検証済みのため、
# ここではhttpx.MockTransportでHTTP呼び出しの配線（リクエスト形状・エラーマッピング）のみを検証する。


def _client_with(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_remote_converter_returns_html_on_success():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/convert"
        assert b'filename="sample.pdf"' in request.content
        return httpx.Response(200, json={"html": "<p>converted-html-marker</p>"})

    converter = RemoteDoclingPDFConverter(
        base_url="http://docling:8100", client=_client_with(handler)
    )

    html = converter.convert_to_html("sample.pdf", b"pdf-bytes")

    assert html == "<p>converted-html-marker</p>"


def test_remote_converter_raises_pdf_conversion_error_on_non_200():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(422, json={"detail": "PDFの解析に失敗しました（テスト用）"})

    converter = RemoteDoclingPDFConverter(
        base_url="http://docling:8100", client=_client_with(handler)
    )

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"not a real pdf content at all")


def test_remote_converter_raises_pdf_conversion_error_on_connection_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    converter = RemoteDoclingPDFConverter(
        base_url="http://docling:8100", client=_client_with(handler)
    )

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("sample.pdf", b"pdf-bytes")


def test_remote_converter_uses_docling_service_url_env(monkeypatch):
    # docker-compose.ymlが設定するDOCLING_SERVICE_URLをbase_url未指定時の既定値として使うことを検証する。
    monkeypatch.setenv("DOCLING_SERVICE_URL", "http://custom-docling-host:9999")
    requested_urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_urls.append(str(request.url))
        return httpx.Response(200, json={"html": "<p>x</p>"})

    converter = RemoteDoclingPDFConverter(client=_client_with(handler))
    converter.convert_to_html("f.pdf", b"x")

    assert requested_urls == ["http://custom-docling-host:9999/convert"]


def test_get_pdf_converter_returns_remote_converter():
    # main.pyのDependsから差し替え可能にするためのファクトリ契約を検証する。
    assert isinstance(get_pdf_converter(), RemoteDoclingPDFConverter)
