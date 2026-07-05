import re

from fastapi.testclient import TestClient

from app.main import app
from app.services.ai_client import AIGenerationError, RenderResult, get_ai_client

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
