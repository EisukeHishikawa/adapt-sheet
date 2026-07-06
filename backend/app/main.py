import json as json_lib
from typing import Optional

from fastapi import Depends, FastAPI, Form, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.services.ai_client import (
    AIClient,
    AIGenerationError,
    build_prompt,
    get_ai_client,
    validate_render_result,
)

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


# ステップ6でモックから本実装へ差し替え。docs/spec.md 3.1のリクエスト項目のうち
# pdfフィールドはステップ7（Docling統合）で扱うため、ここでは未対応とする。
@app.post("/api/render", response_model=RenderResponse, response_model_by_alias=True)
def render(
    html: str = Form(""),
    css: str = Form(""),
    # 標準ライブラリのjsonモジュールと名前が衝突するため、パラメータ名はjson_fieldとし、
    # フォームのフィールド名のみalias="json"でdocs/spec.md 3.1の契約に合わせる。
    json_field: str = Form("{}", alias="json"),
    prompt: str = Form(""),
    width_mm: Optional[float] = Form(None),
    height_mm: Optional[float] = Form(None),
    # FastAPIのDependsで注入することで、テスト側がdependency_overridesにより
    # AIクライアントの成功/失敗を差し替えられるようにする（ADR-007）。
    ai_client: AIClient = Depends(get_ai_client),
) -> RenderResponse:
    try:
        json_data = json_lib.loads(json_field)
    except json_lib.JSONDecodeError as exc:
        # docs/spec.md エラーコード定義: JSON構文エラーは400 Bad Request。
        raise HTTPException(
            status_code=400, detail=f"json フィールドの解析に失敗しました: {exc}"
        ) from exc

    if not isinstance(json_data, dict):
        raise HTTPException(status_code=400, detail="json フィールドはオブジェクト形式である必要があります")

    prompt_text = build_prompt(
        html=html,
        css=css,
        json_data=json_data,
        prompt=prompt,
        width_mm=width_mm,
        height_mm=height_mm,
    )

    try:
        result = ai_client.generate(prompt_text)
        validate_render_result(result)
    except AIGenerationError as exc:
        # docs/spec.md エラーコード定義: AI生成エラー（Claude API呼び出し失敗等）は502 Bad Gateway。
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return RenderResponse(html=result.html, css=result.css, json_=result.data)
