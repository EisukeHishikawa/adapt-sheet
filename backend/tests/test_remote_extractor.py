"""RemoteHtmlExtractorのAWS SigV4署名（Lambda Function URL・AWS_IAM認証、ADR-026）のテスト。

docling_client/pdf2htmlex_clientのどちらも同じRemoteHtmlExtractorを継承するため、
署名ロジック自体はRemoteDoclingHtmlExtractor（_auth_env_var="DOCLING_SERVICE_AUTH"）を
代表として検証する。HTTP配線自体の契約はtest_docling_client.py/test_pdf2htmlex_client.pyで
別途検証済み。
"""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest

from app.services.docling_client import PDFConversionError, RemoteDoclingHtmlExtractor
from tests._pdf_test_helpers import client_with as _client_with

_FAKE_FROZEN_CREDENTIALS = SimpleNamespace(
    access_key="AKIAFAKEEXAMPLE",
    secret_key="fake-secret",
    token=None,
)


class _FakeCredentials:
    def get_frozen_credentials(self):
        return _FAKE_FROZEN_CREDENTIALS


def test_remote_extractor_does_not_sign_by_default():
    # DOCLING_SERVICE_AUTH未設定（docker-compose/ローカル既定）ではAuthorizationヘッダーを付与しない。
    captured_headers = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.update(request.headers)
        return httpx.Response(200, json={"html": "<html>x</html>"})

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))
    extractor.convert_to_html("f.pdf", b"pdf-bytes")

    assert "authorization" not in captured_headers


def test_remote_extractor_signs_with_sigv4_when_auth_env_is_aws_sigv4(monkeypatch):
    monkeypatch.setenv("DOCLING_SERVICE_AUTH", "aws_sigv4")
    monkeypatch.setenv("AWS_REGION", "ap-northeast-1")
    monkeypatch.setattr("boto3.Session.get_credentials", lambda self: _FakeCredentials())

    captured_headers = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.update(request.headers)
        return httpx.Response(200, json={"html": "<html>x</html>"})

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))
    extractor.convert_to_html("f.pdf", b"pdf-bytes")

    assert captured_headers["authorization"].startswith("AWS4-HMAC-SHA256 ")
    assert "x-amz-date" in captured_headers
    # content-type（multipartのboundaryを含む）は署名前にhttpxが確定させた値のまま変わらないこと。
    assert captured_headers["content-type"].startswith("multipart/form-data; boundary=")


def test_remote_extractor_raises_when_aws_sigv4_requested_without_credentials(monkeypatch):
    monkeypatch.setenv("DOCLING_SERVICE_AUTH", "aws_sigv4")
    monkeypatch.setattr("boto3.Session.get_credentials", lambda self: None)

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("署名エラーで送信前に例外になるはず")

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    with pytest.raises(PDFConversionError):
        extractor.convert_to_html("f.pdf", b"pdf-bytes")


def test_warmup_pings_health_endpoint_and_returns_true():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"status": "ok"})

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    assert extractor.warmup() is True
    assert captured["method"] == "GET"
    assert captured["url"] == "http://docling:8100/health"


def test_warmup_signs_with_sigv4_when_auth_env_is_aws_sigv4(monkeypatch):
    monkeypatch.setenv("DOCLING_SERVICE_AUTH", "aws_sigv4")
    monkeypatch.setenv("AWS_REGION", "ap-northeast-1")
    monkeypatch.setattr("boto3.Session.get_credentials", lambda self: _FakeCredentials())

    captured_headers = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.update(request.headers)
        return httpx.Response(200, json={"status": "ok"})

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    assert extractor.warmup() is True
    assert captured_headers["authorization"].startswith("AWS4-HMAC-SHA256 ")


def test_warmup_returns_false_instead_of_raising_on_failure():
    # ウォームアップは画面表示のついでに投げる副次的な処理のため、失敗しても例外にしない。
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    assert extractor.warmup() is False


def test_warmup_returns_false_on_non_200_status():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"Message": "Forbidden"})

    extractor = RemoteDoclingHtmlExtractor(base_url="http://docling:8100", client=_client_with(handler))

    assert extractor.warmup() is False
