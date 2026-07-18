import re
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.ai_client import AIGenerationError, RenderResult, get_ai_client_factory
from app.services.docling_client import get_html_extractor
from app.services.pdf2htmlex_client import get_pdf2htmlex_extractor
from app.services.pdf_layout import get_layout_converter
from app.services.pdf_common import PDFConversionError

# DEVELOPMENT.md ステップ7で追加するPDFアップロードテスト用フィクスチャ。
# scripts/verify_docling.pyやtest_docling_client.pyと同じ実PDFを使い回す。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"

# DEVELOPMENT.md ステップ2のTDD要件: 実装前に「POSTしたらダミーデータが返る」という
# 期待値のみを先に定義する（Red状態）。app/main.py側は本テストを通すための最小実装。
# ステップ6でAI生成に差し替えた後も、レスポンス契約（docs/spec.md 3.1）自体は変わらないため
# このテストは維持し、AI生成特有の挙動（エラー時502等）をテストを追加する形で検証する。
client = TestClient(app)


def _override_ai_client(fake_client) -> None:
    # ADR-015: ai_client_factoryはengineがリクエスト時にしか決まらないため関数を注入する。
    app.dependency_overrides[get_ai_client_factory] = lambda: (lambda engine: fake_client)


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


def test_render_returns_502_when_ai_generation_fails():
    # docs/spec.md エラーコード定義: AI生成エラー（AI API呼び出し失敗等）は502 Bad Gatewayとする。
    # dependency_overridesでAIクライアントを失敗させ、エンドポイントのエラーハンドリングを検証する。
    class _FailingAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            raise AIGenerationError("AI呼び出しに失敗しました（テスト用）")

    _override_ai_client(_FailingAIClient())
    try:
        response = client.post("/api/render", data={})
        assert response.status_code == 502
    finally:
        app.dependency_overrides.pop(get_ai_client_factory, None)


def test_render_sends_pdf_bytes_to_ai_client_when_uploaded():
    # ADR-015: 生成AIエンジンへはPDFファイルをそのままマルチモーダル入力として渡し、
    # PyMuPDF/Docling経由の事前変換は行わない。
    captured = {}

    class _RecordingAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            captured["pdf"] = pdf
            captured["prompt"] = prompt
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    _override_ai_client(_RecordingAIClient())
    try:
        pdf_bytes = SAMPLE_PDF.read_bytes()
        response = client.post(
            "/api/render",
            files={"pdf": ("sample.pdf", pdf_bytes, "application/pdf")},
        )
        assert response.status_code == 200
        assert captured["pdf"] == pdf_bytes
        assert "添付したPDF" in captured["prompt"]
    finally:
        app.dependency_overrides.pop(get_ai_client_factory, None)


def test_render_does_not_invoke_converters_for_ai_engine_with_pdf():
    # ADR-015: AIエンジン選択時はPyMuPDF/Docling/pdf2htmlEXの事前変換を一切呼ばない。
    class _RecordingAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    class _ExplodingConverter:
        def convert_to_html(self, filename, content):
            raise AssertionError("AIエンジンでは呼ばれないはず")

    _override_ai_client(_RecordingAIClient())
    app.dependency_overrides[get_layout_converter] = lambda: _ExplodingConverter()
    app.dependency_overrides[get_html_extractor] = lambda: _ExplodingConverter()
    app.dependency_overrides[get_pdf2htmlex_extractor] = lambda: _ExplodingConverter()
    try:
        response = client.post(
            "/api/render",
            files={"pdf": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        )
        assert response.status_code == 200
    finally:
        app.dependency_overrides.pop(get_ai_client_factory, None)
        app.dependency_overrides.pop(get_layout_converter, None)
        app.dependency_overrides.pop(get_html_extractor, None)
        app.dependency_overrides.pop(get_pdf2htmlex_extractor, None)


def test_render_threads_prompt_into_ai_prompt():
    # promptフィールドがbuild_prompt経由でAI呼び出しのプロンプトへ反映されることを検証する。
    captured_prompts = []

    class _RecordingAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            captured_prompts.append(prompt)
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    _override_ai_client(_RecordingAIClient())
    try:
        response = client.post(
            "/api/render",
            data={"prompt": "請求書レイアウトにして"},
        )
        assert response.status_code == 200
        assert "請求書レイアウトにして" in captured_prompts[0]
    finally:
        app.dependency_overrides.pop(get_ai_client_factory, None)


def test_render_ignores_json_field_if_sent():
    # jsonはAIへの入力として不要なため、リクエストの宣言済みフィールドではなくなった。
    # クライアントが送っても未知のフォームフィールドとしてFastAPIが無視し、
    # エラーにならないことを確認する（ADR-014のcss同様の扱い）。
    response = client.post("/api/render", data={"json": '{"customer": "田中"}'})

    assert response.status_code == 200


def test_render_ignores_html_field_if_sent():
    # ADR-015: htmlはリクエストの宣言済みフィールドではなくなった（生成AIへ送らないため）。
    # クライアントが送っても未知のフォームフィールドとしてFastAPIが無視することを確認する。
    response = client.post("/api/render", data={"html": "<p>古いHTML</p>"})

    assert response.status_code == 200


def test_render_rejects_prompt_exceeding_max_length():
    # セキュリティ対策: promptはプロンプトインジェクション・過大トークン消費のリスクを
    # 抑えるため100文字を上限とし、超過時はdocs/spec.md 4章の400 VALIDATION_ERRORとする。
    response = client.post("/api/render", data={"prompt": "あ" * 101})

    assert response.status_code == 400


def test_render_accepts_prompt_at_max_length():
    # 上限ちょうど（100文字）は拒否されないことを境界値として確認する。
    response = client.post("/api/render", data={"prompt": "あ" * 100})

    assert response.status_code == 200


def test_render_ignores_css_field_if_sent():
    # ADR-014: cssはリクエストの宣言済みフィールドではなくなったため、クライアントが送っても
    # FastAPIが未知のフォームフィールドとして無視し、エラーにならないことを確認する。
    response = client.post("/api/render", data={"css": "body { color: red; }"})

    assert response.status_code == 200


def test_render_mock_returns_delivery_note_for_portrait_size():
    # ADR-014: 既定のMockAIClient（USE_MOCK_AI未設定時）が、width_mm/height_mmから
    # 用紙の向きを判定して縦=納品書のモックを返すことをエンドツーエンドで検証する。
    response = client.post("/api/render", data={"width_mm": "210", "height_mm": "297"})

    assert response.status_code == 200
    assert "納品書" in response.json()["html"]


def test_render_mock_returns_invoice_for_landscape_size():
    # 同様に、横=請求書のモックを返すことを検証する。
    response = client.post("/api/render", data={"width_mm": "297", "height_mm": "210"})

    assert response.status_code == 200
    assert "請求書" in response.json()["html"]


# ADR-015: engine（EngineSelectの選択値）によるゲート判定・分岐の検証。


def test_render_returns_403_for_gemini_standard_engine():
    response = client.post("/api/render", data={"engine": "gemini"})
    assert response.status_code == 403


def test_render_returns_403_for_claude_engine():
    response = client.post("/api/render", data={"engine": "claude"})
    assert response.status_code == 403


def test_render_returns_403_for_openai_engine():
    response = client.post("/api/render", data={"engine": "openai"})
    assert response.status_code == 403


def test_render_gate_check_happens_before_pdf_processing():
    # ゲート対象engineは、PDF処理・AI呼び出しより前に判定し、無駄な処理をしない（ADR-015）。
    class _ExplodingConverter:
        def convert_to_html(self, filename, content):
            raise AssertionError("ゲートで弾かれるはずなので呼ばれない")

    app.dependency_overrides[get_layout_converter] = lambda: _ExplodingConverter()
    try:
        response = client.post(
            "/api/render",
            data={"engine": "claude"},
            files={"pdf": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        )
        assert response.status_code == 403
    finally:
        app.dependency_overrides.pop(get_layout_converter, None)


def test_render_pymupdf_engine_returns_converted_html_without_ai():
    class _FakeLayoutConverter:
        def convert_to_html(self, filename, content):
            return "<html><body>pymupdf-marker</body></html>"

    app.dependency_overrides[get_layout_converter] = lambda: _FakeLayoutConverter()
    try:
        response = client.post(
            "/api/render",
            data={"engine": "pymupdf"},
            files={"pdf": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["html"] == "<html><body>pymupdf-marker</body></html>"
        assert body["css"] == ""
        assert body["json"] == {}
    finally:
        app.dependency_overrides.pop(get_layout_converter, None)


def test_render_docling_engine_returns_converted_html_without_ai():
    class _FakeExtractor:
        def convert_to_html(self, filename, content):
            return "<html><body>docling-marker</body></html>"

    app.dependency_overrides[get_html_extractor] = lambda: _FakeExtractor()
    try:
        response = client.post(
            "/api/render",
            data={"engine": "docling"},
            files={"pdf": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        )
        assert response.status_code == 200
        assert response.json()["html"] == "<html><body>docling-marker</body></html>"
    finally:
        app.dependency_overrides.pop(get_html_extractor, None)


def test_render_pdf2htmlex_engine_returns_converted_html_without_ai():
    class _FakeExtractor:
        def convert_to_html(self, filename, content):
            return "<html><body>pdf2htmlex-marker</body></html>"

    app.dependency_overrides[get_pdf2htmlex_extractor] = lambda: _FakeExtractor()
    try:
        response = client.post(
            "/api/render",
            data={"engine": "pdf2htmlex"},
            files={"pdf": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        )
        assert response.status_code == 200
        assert response.json()["html"] == "<html><body>pdf2htmlex-marker</body></html>"
    finally:
        app.dependency_overrides.pop(get_pdf2htmlex_extractor, None)


def test_render_converter_engine_requires_pdf():
    response = client.post("/api/render", data={"engine": "pymupdf"})
    assert response.status_code == 400


def test_render_converter_engine_does_not_call_ai_client():
    class _ExplodingAIClient:
        def generate(self, prompt, pdf=None):
            raise AssertionError("変換エンジンではAIを呼ばないはず")

    class _FakeLayoutConverter:
        def convert_to_html(self, filename, content):
            return "<html></html>"

    _override_ai_client(_ExplodingAIClient())
    app.dependency_overrides[get_layout_converter] = lambda: _FakeLayoutConverter()
    try:
        response = client.post(
            "/api/render",
            data={"engine": "pymupdf"},
            files={"pdf": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        )
        assert response.status_code == 200
    finally:
        app.dependency_overrides.pop(get_ai_client_factory, None)
        app.dependency_overrides.pop(get_layout_converter, None)


def test_render_returns_422_when_docling_engine_conversion_fails():
    # docs/spec.md エラーコード定義: PDF解析エラーは422 Unprocessable Entityとする。
    class _FailingExtractor:
        def convert_to_html(self, filename, content):
            raise PDFConversionError("PDFの解析に失敗しました（テスト用）")

    app.dependency_overrides[get_html_extractor] = lambda: _FailingExtractor()
    try:
        response = client.post(
            "/api/render",
            data={"engine": "docling"},
            files={"pdf": ("broken.pdf", b"not a real pdf", "application/pdf")},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(get_html_extractor, None)


def test_render_returns_422_when_pymupdf_engine_conversion_fails():
    class _FailingConverter:
        def convert_to_html(self, filename, content):
            raise PDFConversionError("PDFの解析に失敗しました（テスト用）")

    app.dependency_overrides[get_layout_converter] = lambda: _FailingConverter()
    try:
        response = client.post(
            "/api/render",
            data={"engine": "pymupdf"},
            files={"pdf": ("broken.pdf", b"not a real pdf", "application/pdf")},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(get_layout_converter, None)


def test_render_returns_422_when_pdf2htmlex_engine_conversion_fails():
    class _FailingConverter:
        def convert_to_html(self, filename, content):
            raise PDFConversionError("PDFの解析に失敗しました（テスト用）")

    app.dependency_overrides[get_pdf2htmlex_extractor] = lambda: _FailingConverter()
    try:
        response = client.post(
            "/api/render",
            data={"engine": "pdf2htmlex"},
            files={"pdf": ("broken.pdf", b"not a real pdf", "application/pdf")},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(get_pdf2htmlex_extractor, None)
