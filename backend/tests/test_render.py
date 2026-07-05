from fastapi.testclient import TestClient

from app.main import app

# DEVELOPMENT.md ステップ2のTDD要件: 実装前に「POSTしたらダミーデータが返る」という
# 期待値のみを先に定義する（Red状態）。app/main.py側は本テストを通すための最小実装。
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
