from fastapi import FastAPI

app = FastAPI()


# ステップ2時点では実ロジック（Docling解析・Claude生成）を持たないモックエンドポイント。
# テスト（tests/test_render.py）を通すための最小実装で、フェーズ3で本実装に差し替える。
@app.post("/api/render")
def render():
    return {
        "html": "<!doctype html><html><body><p>{{dummy}}</p></body></html>",
        "css": "body { font-family: sans-serif; }",
        "json": {"dummy": "sample"},
    }
