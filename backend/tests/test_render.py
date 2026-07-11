import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.ai_client import AIGenerationError, RenderResult, get_ai_client
from app.services.docling_client import PDFConversionError, get_pdf_converter

# DEVELOPMENT.md ステップ7で追加するPDFアップロードテスト用フィクスチャ。
# scripts/verify_docling.pyやtest_docling_client.pyと同じ実PDFを使い回す。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"

# DEVELOPMENT.md ステップ2のTDD要件: 実装前に「POSTしたらダミーデータが返る」という
# 期待値のみを先に定義する（Red状態）。app/main.py側は本テストを通すための最小実装。
# ステップ6でAI生成に差し替えた後も、レスポンス契約（docs/spec.md 3.1）自体は変わらないため
# このテストは維持し、AI生成特有の挙動（エラー時502等）をテストを追加する形で検証する。
client = TestClient(app)


def test_render_returns_dummy_html_css_json():
    response = client.post("/api/render", data={})

    assert response.status_code == 200
    body = response.json()
    # レスポンスがhtml/css/jsonの3キーを持つという契約（docs/spec.md 3.1）を検証する。
    assert "html" in body
    assert "css" in body
    assert "json" in body
    assert isinstance(body["html"], str) and body["html"] != ""
    assert isinstance(body["css"], str) and body["css"] != ""
    assert isinstance(body["json"], dict)


def test_render_response_placeholders_exist_in_json():
    # CLAUDE.mdの「固定情報と業務データの分離」規約: htmlのテンプレート変数は
    # 必ずjsonのキーと対応している必要がある（エンドツーエンドでの契約検証）。
    response = client.post("/api/render", data={})
    body = response.json()

    placeholders = set(re.findall(r"\{\{(\w+)\}\}", body["html"]))
    assert placeholders <= set(body["json"].keys())


def test_render_rejects_invalid_json_field():
    # docs/spec.md エラーコード定義: JSON構文エラーは400 Bad Requestとする。
    response = client.post("/api/render", data={"json": "{invalid"})

    assert response.status_code == 400


def test_render_returns_502_when_ai_generation_fails():
    # docs/spec.md エラーコード定義: AI生成エラー（Claude API呼び出し失敗等）は502 Bad Gatewayとする。
    # dependency_overridesでAIクライアントを失敗させ、エンドポイントのエラーハンドリングを検証する。
    class _FailingAIClient:
        def generate(self, prompt: str) -> RenderResult:
            raise AIGenerationError("AI呼び出しに失敗しました（テスト用）")

    app.dependency_overrides[get_ai_client] = lambda: _FailingAIClient()
    try:
        response = client.post("/api/render", data={})
        assert response.status_code == 502
    finally:
        app.dependency_overrides.pop(get_ai_client, None)


def test_render_uses_docling_html_when_pdf_uploaded():
    # docs/architecture.md 2節のシーケンス図: PDFが送信された場合、Docling変換結果が
    # プロンプト構築のコンテキストとして使われることを検証する。
    # 実際のDocling変換は重い（モデルロード）ため、ここではdependency_overridesで
    # 高速なフェイクに差し替え、main.pyの配線（変換結果をプロンプトへ渡す処理）のみを検証する
    # （実際にDoclingが正しくHTML抽出できることはtest_docling_client.pyで別途検証済み）。
    captured_prompts = []

    class _RecordingAIClient:
        def generate(self, prompt: str) -> RenderResult:
            captured_prompts.append(prompt)
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    class _FakePDFConverter:
        def convert_to_html(self, filename: str, content: bytes) -> str:
            return "<p>docling-extracted-html-marker</p>"

    app.dependency_overrides[get_ai_client] = lambda: _RecordingAIClient()
    app.dependency_overrides[get_pdf_converter] = lambda: _FakePDFConverter()
    try:
        response = client.post(
            "/api/render",
            data={"html": "<p>pdfがある場合はこちらは使われない想定</p>"},
            files={"pdf": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        )
        assert response.status_code == 200
        assert "docling-extracted-html-marker" in captured_prompts[0]
    finally:
        app.dependency_overrides.pop(get_ai_client, None)
        app.dependency_overrides.pop(get_pdf_converter, None)


def test_render_threads_json_and_prompt_into_ai_prompt():
    # json/promptフィールドがbuild_prompt経由でAI呼び出しのプロンプトへ反映されることを検証する。
    captured_prompts = []

    class _RecordingAIClient:
        def generate(self, prompt: str) -> RenderResult:
            captured_prompts.append(prompt)
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    app.dependency_overrides[get_ai_client] = lambda: _RecordingAIClient()
    try:
        response = client.post(
            "/api/render",
            data={"json": '{"customer": "田中"}', "prompt": "請求書レイアウトにして"},
        )
        assert response.status_code == 200
        assert '"customer": "田中"' in captured_prompts[0]
        assert "請求書レイアウトにして" in captured_prompts[0]
    finally:
        app.dependency_overrides.pop(get_ai_client, None)


def test_render_ignores_css_field_if_sent():
    # ADR-019: cssはリクエストの宣言済みフィールドではなくなったため、クライアントが送っても
    # FastAPIが未知のフォームフィールドとして無視し、エラーにならないことを確認する。
    response = client.post("/api/render", data={"css": "body { color: red; }"})

    assert response.status_code == 200


def test_render_mock_returns_delivery_note_for_portrait_size():
    # ADR-020: 既定のMockAIClient（USE_MOCK_AI未設定時）が、width_mm/height_mmから
    # 用紙の向きを判定して縦=納品書のモックを返すことをエンドツーエンドで検証する。
    response = client.post("/api/render", data={"width_mm": "210", "height_mm": "297"})

    assert response.status_code == 200
    assert "納品書" in response.json()["html"]


def test_render_mock_returns_invoice_for_landscape_size():
    # 同様に、横=請求書のモックを返すことを検証する。
    response = client.post("/api/render", data={"width_mm": "297", "height_mm": "210"})

    assert response.status_code == 200
    assert "請求書" in response.json()["html"]


def test_render_returns_422_when_pdf_conversion_fails():
    # docs/spec.md エラーコード定義: Docling解析エラーは422 Unprocessable Entityとする。
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
    finally:
        app.dependency_overrides.pop(get_pdf_converter, None)
