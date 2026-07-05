from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()


# response_modelとして明示することで、openapi.json（フロントの型生成元。docs/spec.md 3.2）に
# html/css/jsonの型が正しく出力されるようにする。dictの直接returnだとFastAPIが
# 型情報を推論できずopenapi.jsonのレスポンススキーマがobject止まりになるため。
class RenderResponse(BaseModel):
    # docs/spec.md 3.1のレスポンス例に合わせ、Python予約語と衝突する`json`キー名を
    # エイリアスとして公開する（内部属性名はjson_）。
    model_config = ConfigDict(populate_by_name=True)

    html: str
    css: str
    json_: dict = Field(default_factory=dict, alias="json")


# ステップ2時点では実ロジック（Docling解析・Claude生成）を持たないモックエンドポイント。
# テスト（tests/test_render.py）を通すための最小実装で、フェーズ3で本実装に差し替える。
@app.post("/api/render", response_model=RenderResponse, response_model_by_alias=True)
def render() -> RenderResponse:
    return RenderResponse(
        html="<!doctype html><html><body><p>{{dummy}}</p></body></html>",
        css="body { font-family: sans-serif; }",
        json_={"dummy": "sample"},
    )
