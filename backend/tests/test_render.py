import re
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.ai_client import AIGenerationError, RenderResult, get_ai_client
from app.services.docling_client import get_markdown_extractor
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


def test_render_passes_layout_html_and_markdown_to_prompt_when_pdf_uploaded():
    # ADR-023: PDFが送信された場合、PyMuPDF由来のレイアウトHTML（見た目）とDocling由来の
    # Markdown（テキスト）の両方がプロンプトへ渡ることを検証する。実変換は重いため、
    # dependency_overridesで高速なフェイクに差し替え、main.pyの配線のみを検証する。
    captured_prompts = []

    class _RecordingAIClient:
        def generate(self, prompt: str) -> RenderResult:
            captured_prompts.append(prompt)
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    class _FakeMarkdownExtractor:
        def convert_to_markdown(self, filename: str, content: bytes) -> str:
            return "# docling-extracted-markdown-marker"

    class _FakeLayoutConverter:
        def convert_to_html(self, filename: str, content: bytes) -> str:
            return "<html><body>layout-html-marker</body></html>"

    app.dependency_overrides[get_ai_client] = lambda: _RecordingAIClient()
    app.dependency_overrides[get_markdown_extractor] = lambda: _FakeMarkdownExtractor()
    app.dependency_overrides[get_layout_converter] = lambda: _FakeLayoutConverter()
    try:
        response = client.post(
            "/api/render",
            data={"html": "<p>pdfがある場合はこちらは使われない想定</p>"},
            files={"pdf": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        )
        assert response.status_code == 200
        assert "layout-html-marker" in captured_prompts[0]
        assert "docling-extracted-markdown-marker" in captured_prompts[0]
    finally:
        app.dependency_overrides.pop(get_ai_client, None)
        app.dependency_overrides.pop(get_markdown_extractor, None)
        app.dependency_overrides.pop(get_layout_converter, None)


def test_render_calls_docling_and_layout_in_parallel():
    # ADR-023: Doclingの呼び出しとPyMuPDF変換はどちらも秒単位の処理時間がかかるため、直列ではなく並列に呼ぶ。
    # 各変換を0.5秒スリープさせ、合計所要時間が直列（1.0秒）ではなく並列（0.5秒強）に収まることで
    # 並列実行を検証する。
    delay_seconds = 0.5

    class _SlowMarkdownExtractor:
        def convert_to_markdown(self, filename: str, content: bytes) -> str:
            time.sleep(delay_seconds)
            return "# markdown"

    class _SlowLayoutConverter:
        def convert_to_html(self, filename: str, content: bytes) -> str:
            time.sleep(delay_seconds)
            return "<html></html>"

    app.dependency_overrides[get_markdown_extractor] = lambda: _SlowMarkdownExtractor()
    app.dependency_overrides[get_layout_converter] = lambda: _SlowLayoutConverter()
    try:
        started_at = time.monotonic()
        response = client.post(
            "/api/render",
            files={"pdf": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        )
        elapsed = time.monotonic() - started_at

        assert response.status_code == 200
        assert elapsed < delay_seconds * 2
    finally:
        app.dependency_overrides.pop(get_markdown_extractor, None)
        app.dependency_overrides.pop(get_layout_converter, None)


def test_render_threads_prompt_into_ai_prompt():
    # promptフィールドがbuild_prompt経由でAI呼び出しのプロンプトへ反映されることを検証する。
    captured_prompts = []

    class _RecordingAIClient:
        def generate(self, prompt: str) -> RenderResult:
            captured_prompts.append(prompt)
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    app.dependency_overrides[get_ai_client] = lambda: _RecordingAIClient()
    try:
        response = client.post(
            "/api/render",
            data={"prompt": "請求書レイアウトにして"},
        )
        assert response.status_code == 200
        assert "請求書レイアウトにして" in captured_prompts[0]
    finally:
        app.dependency_overrides.pop(get_ai_client, None)


def test_render_ignores_json_field_if_sent():
    # jsonはGeminiへの入力として不要になったため、リクエストの宣言済みフィールドではなくなった。
    # クライアントが送っても未知のフォームフィールドとしてFastAPIが無視し、
    # エラーにならないことを確認する（ADR-019のcss同様の扱い）。
    response = client.post("/api/render", data={"json": '{"customer": "田中"}'})

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
    # docs/spec.md エラーコード定義: PDF解析エラーは422 Unprocessable Entityとする。
    # Docling・レイアウト生成のどちらが失敗しても同じPDFConversionErrorへ集約される（ADR-023）。
    class _FailingMarkdownExtractor:
        def convert_to_markdown(self, filename: str, content: bytes) -> str:
            raise PDFConversionError("PDFの解析に失敗しました（テスト用）")

    class _FakeLayoutConverter:
        def convert_to_html(self, filename: str, content: bytes) -> str:
            return "<html></html>"

    app.dependency_overrides[get_markdown_extractor] = lambda: _FailingMarkdownExtractor()
    app.dependency_overrides[get_layout_converter] = lambda: _FakeLayoutConverter()
    try:
        response = client.post(
            "/api/render",
            files={"pdf": ("broken.pdf", b"not a real pdf", "application/pdf")},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(get_markdown_extractor, None)
        app.dependency_overrides.pop(get_layout_converter, None)


def test_render_returns_422_when_layout_conversion_fails():
    class _FakeMarkdownExtractor:
        def convert_to_markdown(self, filename: str, content: bytes) -> str:
            return "# markdown"

    class _FailingLayoutConverter:
        def convert_to_html(self, filename: str, content: bytes) -> str:
            raise PDFConversionError("PDFの解析に失敗しました（テスト用）")

    app.dependency_overrides[get_markdown_extractor] = lambda: _FakeMarkdownExtractor()
    app.dependency_overrides[get_layout_converter] = lambda: _FailingLayoutConverter()
    try:
        response = client.post(
            "/api/render",
            files={"pdf": ("broken.pdf", b"not a real pdf", "application/pdf")},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.pop(get_markdown_extractor, None)
        app.dependency_overrides.pop(get_layout_converter, None)
