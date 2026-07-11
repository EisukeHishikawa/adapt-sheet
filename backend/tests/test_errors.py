"""構造化エラーレスポンス（ADR-017、DEVELOPMENT.md ステップ14）の検証テスト。

各エラーが `{"error": {"code", "message", "request_id"}}` の形で返り、
ボディのrequest_idがX-Request-IDヘッダーと一致することを検証する。
実装（例外ハンドラ）より先に期待値を固定するTDDの位置づけ。
"""

from fastapi.testclient import TestClient

from app.main import app
from app.services.ai_client import RenderResult, get_ai_client

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
        def generate(self, prompt: str) -> RenderResult:
            raise AIGenerationError("AI呼び出しに失敗しました（テスト用）")

    app.dependency_overrides[get_ai_client] = lambda: _FailingAIClient()
    try:
        response = client.post("/api/render", data={})
        assert response.status_code == 502
        request_id = _assert_error_envelope(response.json(), "AI_GENERATION_ERROR")
        assert request_id == response.headers["X-Request-ID"]
    finally:
        app.dependency_overrides.pop(get_ai_client, None)


def test_pdf_conversion_error_returns_structured_body():
    from app.services.docling_client import PDFConversionError, get_pdf_converter

    class _FailingPDFConverter:
        def convert_to_html(self, filename: str, content: bytes) -> str:
            raise PDFConversionError("PDFの解析に失敗しました（テスト用）")

    app.dependency_overrides[get_pdf_converter] = lambda: _FailingPDFConverter()
    try:
        response = client.post(
            "/api/render",
            files={"pdf": ("broken.pdf", b"not a real pdf", "application/pdf")},
        )
        assert response.status_code == 422
        request_id = _assert_error_envelope(response.json(), "PDF_CONVERSION_ERROR")
        assert request_id == response.headers["X-Request-ID"]
    finally:
        app.dependency_overrides.pop(get_pdf_converter, None)


def test_unhandled_exception_returns_500_structured_body():
    # 登録済みハンドラで捕捉されない想定外例外は、ミドルウェアが500エンベロープへ変換する。
    class _BrokenAIClient:
        def generate(self, prompt: str) -> RenderResult:
            raise ValueError("想定外の内部エラー（テスト用）")

    app.dependency_overrides[get_ai_client] = lambda: _BrokenAIClient()
    try:
        response = client.post("/api/render", data={})
        assert response.status_code == 500
        request_id = _assert_error_envelope(response.json(), "INTERNAL_ERROR")
        assert request_id == response.headers["X-Request-ID"]
    finally:
        app.dependency_overrides.pop(get_ai_client, None)


def test_success_response_has_request_id_header():
    # 成功時（既定のMockAIClient）も相関IDヘッダーが付く。
    response = client.post("/api/render", data={})
    assert response.status_code == 200
    assert response.headers.get("X-Request-ID")
