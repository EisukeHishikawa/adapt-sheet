"""構造化エラーレスポンスの検証テスト。

各エラーが `{"error": {"code", "message", "request_id"}}` の形で返り、
ボディのrequest_idがX-Request-IDヘッダーと一致することを検証する。
実装（例外ハンドラ）より先に期待値を固定するTDDの位置づけ。
"""

import pytest
from fastapi.testclient import TestClient

from app.errors import status_code_for
from app.main import app
from app.services.ai_client import (
    AIGenerationError,
    AIServiceSuspendedError,
    AIServiceUnavailableError,
    RenderResult,
    get_ai_client_factory,
)
from app.services.job_store import get_job_store
from app.services.pdf_common import PDFConversionError

client = TestClient(app)


def _assert_error_envelope(body: dict, expected_code: str) -> str:
    """エラーエンベロープの共通構造を検証し、request_idを返すヘルパー。"""
    assert set(body.keys()) == {"error"}
    error = body["error"]
    assert set(error.keys()) == {"code", "message", "request_id"}
    assert error["code"] == expected_code
    # messageはユーザー向けの非空文字列（安全文言）。
    assert isinstance(error["message"], str) and error["message"] != ""
    assert isinstance(error["request_id"], str) and error["request_id"] != ""
    return error["request_id"]


def test_validation_error_returns_structured_body():
    # サイズ指定の型不正（width_mmが数値でない）→ 400 VALIDATION_ERROR（docs/spec.md 4章）。
    response = client.post("/api/render", data={"width_mm": "not-a-number"})

    assert response.status_code == 400
    request_id = _assert_error_envelope(response.json(), "VALIDATION_ERROR")
    # ボディのrequest_idはX-Request-IDヘッダーと一致する（画面⇔ログ相関の要）。
    assert request_id == response.headers["X-Request-ID"]


def test_ai_generation_error_returns_structured_body():
    from app.services.ai_client import AIGenerationError

    class _FailingAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            raise AIGenerationError("AI呼び出しに失敗しました（テスト用）")

    app.dependency_overrides[get_ai_client_factory] = lambda: (lambda engine: _FailingAIClient())
    try:
        response = client.post("/api/render", data={})
        assert response.status_code == 502
        request_id = _assert_error_envelope(response.json(), "AI_GENERATION_ERROR")
        assert request_id == response.headers["X-Request-ID"]
    finally:
        app.dependency_overrides.pop(get_ai_client_factory, None)


def test_free_access_forbidden_returns_structured_body():
    # 未ログインのユーザーは標準プランの生成AIを利用できない。
    response = client.post("/api/render", data={"engine": "claude"})

    assert response.status_code == 403
    request_id = _assert_error_envelope(response.json(), "FREE_ACCESS_FORBIDDEN")
    assert request_id == response.headers["X-Request-ID"]


def test_pdf_conversion_error_returns_structured_body():
    from app.services.docling_client import get_html_extractor
    from app.services.pdf_common import PDFConversionError

    class _FailingExtractor:
        def convert_to_html(self, filename: str, content: bytes) -> str:
            raise PDFConversionError("PDFの解析に失敗しました（テスト用）")

    app.dependency_overrides[get_html_extractor] = lambda: _FailingExtractor()
    try:
        response = client.post(
            "/api/render",
            data={"engine": "docling"},
            files={"pdf": ("broken.pdf", b"not a real pdf", "application/pdf")},
        )
        assert response.status_code == 422
        request_id = _assert_error_envelope(response.json(), "PDF_CONVERSION_ERROR")
        assert request_id == response.headers["X-Request-ID"]
    finally:
        app.dependency_overrides.pop(get_html_extractor, None)


def test_unhandled_exception_returns_500_structured_body():
    # 登録済みハンドラで捕捉されない想定外例外は、ミドルウェアが500エンベロープへ変換する。
    class _BrokenAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            raise ValueError("想定外の内部エラー（テスト用）")

    app.dependency_overrides[get_ai_client_factory] = lambda: (lambda engine: _BrokenAIClient())
    try:
        response = client.post("/api/render", data={})
        assert response.status_code == 500
        request_id = _assert_error_envelope(response.json(), "INTERNAL_ERROR")
        assert request_id == response.headers["X-Request-ID"]
    finally:
        app.dependency_overrides.pop(get_ai_client_factory, None)


def test_success_response_has_request_id_header():
    # 成功時（既定のMockAIClient）も相関IDヘッダーが付く。
    response = client.post("/api/render", data={})
    assert response.status_code == 200
    assert response.headers.get("X-Request-ID")


class _RecordingJobStore:
    def __init__(self) -> None:
        self.statuses: dict[str, dict] = {}

    def write_status(self, job_id: str, payload: dict) -> None:
        self.statuses[job_id] = payload


_DOMAIN_ERROR_CASES = [
    (AIGenerationError, 502, "AI_GENERATION_ERROR"),
    (AIServiceUnavailableError, 503, "AI_SERVICE_UNAVAILABLE"),
    (AIServiceSuspendedError, 501, "AI_SERVICE_SUSPENDED"),
]


@pytest.mark.parametrize("error_type, expected_status, expected_code", _DOMAIN_ERROR_CASES)
def test_domain_error_maps_identically_in_sync_and_job_paths(
    error_type, expected_status, expected_code
):
    """同期経路（例外ハンドラ経由）と非同期ジョブ経路（ハンドラを通らない）が、同じ例外に対して
    同じステータス・同じ文言を返すことを保証する。両者が別々の対応表を持つと片方だけ古くなる。
    """

    class _FailingAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            raise error_type("AI呼び出しに失敗しました（テスト用）")

    job_store = _RecordingJobStore()
    app.dependency_overrides[get_ai_client_factory] = lambda: (lambda engine: _FailingAIClient())
    app.dependency_overrides[get_job_store] = lambda: job_store
    try:
        sync_response = client.post("/api/render", data={})
        job_response = client.post(
            "/internal/render-jobs/process",
            json={"job_id": "job-1", "engine": "gemini_free"},
        )
    finally:
        app.dependency_overrides.pop(get_ai_client_factory, None)
        app.dependency_overrides.pop(get_job_store, None)

    assert sync_response.status_code == expected_status
    assert sync_response.json()["error"]["code"] == expected_code
    assert job_response.status_code == 202
    assert job_store.statuses["job-1"]["status"] == "error"
    assert job_store.statuses["job-1"]["message"] == sync_response.json()["error"]["message"]


def test_status_code_for_maps_domain_errors_and_falls_back_to_500():
    assert status_code_for(PDFConversionError("テスト用")) == 422
    assert status_code_for(AIServiceUnavailableError("テスト用")) == 503
    assert status_code_for(AIServiceSuspendedError("テスト用")) == 501
    assert status_code_for(AIGenerationError("テスト用")) == 502
    assert status_code_for(ValueError("テスト用")) == 500
