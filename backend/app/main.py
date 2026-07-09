import json as json_lib
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.errors import (
    ai_generation_error_handler,
    http_exception_handler,
    pdf_conversion_error_handler,
    validation_exception_handler,
)
from app.logging_config import configure_logging
from app.middleware import RequestContextMiddleware
from app.services.ai_client import (
    AIClient,
    AIGenerationError,
    build_prompt,
    get_ai_client,
    validate_render_result,
)
from app.services.docling_client import (
    PDFConversionError,
    PDFConverter,
    get_pdf_converter,
)

# アプリ生成前にログ設定を行い、起動〜リクエスト処理まで一貫してJSON構造化ログにする（ADR-016）。
configure_logging()

app = FastAPI()

# リクエスト相関ID採番・アクセスログ・想定外例外の500化（ADR-016/017、app/middleware.py）。
app.add_middleware(RequestContextMiddleware)

# 例外→構造化エラーレスポンスの整形をハンドラへ集約する（ADR-017）。
# StarletteHTTPExceptionで登録することで、FastAPI/Starlette双方のHTTPExceptionを捕捉する。
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
# 入力バリデーション失敗はdocs/spec.md 4章に合わせ400へ寄せる（FastAPI既定の422はDocling専用のため）。
app.add_exception_handler(RequestValidationError, validation_exception_handler)
# ドメイン例外はmain.py内でHTTPExceptionへ変換せず、送出のみ行いここで一元的に整形する。
app.add_exception_handler(PDFConversionError, pdf_conversion_error_handler)
app.add_exception_handler(AIGenerationError, ai_generation_error_handler)


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


# ステップ6でモックから本実装へ差し替え、ステップ7でpdfフィールド（Docling統合）に対応。
@app.post("/api/render", response_model=RenderResponse, response_model_by_alias=True)
def render(
    # ADR-019によりcssは独立したリクエストフィールドを持たない（既存CSSはhtml側の<style>に
    # 埋め込まれている前提のため）。
    html: str = Form(""),
    # 標準ライブラリのjsonモジュールと名前が衝突するため、パラメータ名はjson_fieldとし、
    # フォームのフィールド名のみalias="json"でdocs/spec.md 3.1の契約に合わせる。
    json_field: str = Form("{}", alias="json"),
    prompt: str = Form(""),
    width_mm: Optional[float] = Form(None),
    height_mm: Optional[float] = Form(None),
    pdf: Optional[UploadFile] = File(None),
    # FastAPIのDependsで注入することで、テスト側がdependency_overridesにより
    # AIクライアントの成功/失敗を差し替えられるようにする（ADR-007）。
    ai_client: AIClient = Depends(get_ai_client),
    # 同様にDocling変換もDependsで注入し、テスト側で高速なフェイクに差し替え可能にする。
    pdf_converter: PDFConverter = Depends(get_pdf_converter),
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

    # docs/architecture.md 2節のシーケンス図: PDFが存在する場合、Doclingで抽出したHTMLを
    # 既存htmlフィールドの代わりにプロンプト構築のベースコンテキストとして使う。
    # ADR-017に基づき、PDFConversionErrorはここで捕捉せずそのまま送出し、
    # app/errors.pyのハンドラで422構造化エラーへ一元変換する。
    effective_html = html
    if pdf is not None:
        effective_html = pdf_converter.convert_to_html(pdf.filename or "uploaded.pdf", pdf.file.read())

    prompt_text = build_prompt(
        html=effective_html,
        json_data=json_data,
        prompt=prompt,
        width_mm=width_mm,
        height_mm=height_mm,
    )

    # ADR-017に基づき、AIGenerationErrorもここでは捕捉せず、ハンドラで502構造化エラーへ変換する。
    result = ai_client.generate(prompt_text)
    validate_render_result(result)

    return RenderResponse(html=result.html, css=result.css, json_=result.data)
