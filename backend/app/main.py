import asyncio
import logging
from typing import Callable, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.db import get_db_session, get_db_session_or_none
from app.errors import (
    ai_generation_error_handler,
    http_exception_handler,
    pdf_conversion_error_handler,
    validation_exception_handler,
)
from app.logging_config import configure_logging
from app.middleware import RequestContextMiddleware
from app.secrets_loader import load_secrets_into_env
from app.services.auth import SupabaseUser, get_current_user
from app.services.ai_client import (
    AIClient,
    AIGenerationError,
    CONVERTER_ENGINES,
    GATED_ENGINES,
    build_prompt,
    get_ai_client_factory,
    validate_render_result,
)
from app.services.docling_client import PDFHtmlExtractor as DoclingHtmlExtractor, get_html_extractor
from app.services.history import list_history, save_history
from app.services.pdf2htmlex_client import (
    PDFHtmlExtractor as Pdf2HtmlExExtractor,
    get_pdf2htmlex_extractor,
)
from app.services.pdf_layout import PDFLayoutConverter, get_layout_converter
from app.services.pdf_common import PDFConversionError

logger = logging.getLogger("app.history")

# アプリ生成前に設定し、起動〜リクエスト処理まで一貫してJSON構造化ログにする（ADR-011）。
configure_logging()

# Lambdaのコールドスタート時（このモジュールのimport）に一度だけParameter StoreからAPIキーを
# os.environへ展開する（ADR-017）。ハンドラ内で毎リクエストSSMを叩かないための鉄則。
# SSM_PARAMETER_PREFIX未設定のローカル/pytestでは no-op。
load_secrets_into_env()

app = FastAPI()

# リクエスト相関ID採番・アクセスログ・想定外例外の500化（ADR-011/013）。
app.add_middleware(RequestContextMiddleware)

# 例外→構造化エラーレスポンスの整形はハンドラへ集約する（ADR-012）。StarletteHTTPExceptionで
# 登録することで、FastAPI/Starlette双方のHTTPExceptionを捕捉する。
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(PDFConversionError, pdf_conversion_error_handler)
app.add_exception_handler(AIGenerationError, ai_generation_error_handler)


# response_modelを明示しないと、FastAPIが型を推論できずopenapi.json（フロントの型生成元。ADR-005）の
# レスポンススキーマがobject止まりになる。
class RenderResponse(BaseModel):
    # Python予約語と衝突する`json`キー名をエイリアスとして公開する（docs/spec.md 3.1のレスポンス例）。
    model_config = ConfigDict(populate_by_name=True)

    html: str
    css: str
    json_: dict = Field(default_factory=dict, alias="json")


@app.post("/api/render", response_model=RenderResponse, response_model_by_alias=True)
async def render(
    # セキュリティ対策: promptはプロンプトインジェクションの温床になり得る自由入力のため、
    # フロント（PromptInput.tsxのmaxLength）と合わせて長さを二重に制限する。超過時は
    # RequestValidationError経由でapp/errors.pyが400 VALIDATION_ERRORへ変換する。
    prompt: str = Form("", max_length=100),
    width_mm: Optional[float] = Form(None),
    height_mm: Optional[float] = Form(None),
    # フロント（EngineSelect）が選択した生成エンジン（ADR-015）。7値のいずれか。
    engine: str = Form("gemini_free"),
    pdf: Optional[UploadFile] = File(None),
    # Dependsで注入することで、テスト側がdependency_overridesにより成功/失敗や高速なフェイクへ
    # 差し替えられるようにする（ADR-006）。ai_client_factoryはengineがリクエスト時にしか
    # 決まらないため、AIClientインスタンスではなく関数を注入する（ADR-015）。
    ai_client_factory: Callable[[str], AIClient] = Depends(get_ai_client_factory),
    layout_converter: PDFLayoutConverter = Depends(get_layout_converter),
    html_extractor: DoclingHtmlExtractor = Depends(get_html_extractor),
    pdf2htmlex_extractor: Pdf2HtmlExExtractor = Depends(get_pdf2htmlex_extractor),
    current_user: Optional[SupabaseUser] = Depends(get_current_user),
    db_session: Optional[Session] = Depends(get_db_session_or_none),
) -> RenderResponse:
    # 標準プランの生成AI（Gemini標準/Claude/OpenAI）はログイン済みユーザーのみに提供する
    # （ADR-015のゲート判定を、DEVELOPMENT.md ステップ27でSupabase Authのログイン状態へ差し替え）。
    # PDF処理・AI呼び出しより前に判定し、無駄な処理を避ける。
    if engine in GATED_ENGINES and current_user is None:
        raise HTTPException(status_code=403)

    if engine in CONVERTER_ENGINES:
        # Docling/pdf2htmlEX/PyMuPDFはAIを介さず、変換結果をそのまま描画結果にする（ADR-015）。
        if pdf is None:
            raise HTTPException(status_code=400)
        content = await pdf.read()
        filename = pdf.filename or "uploaded.pdf"
        html = await _convert_with_engine(
            engine, layout_converter, html_extractor, pdf2htmlex_extractor, filename, content
        )
        _save_history(
            db_session,
            current_user,
            engine=engine,
            html=html,
            css="",
            json_data={},
            width_mm=width_mm,
            height_mm=height_mm,
        )
        return RenderResponse(html=html, css="", json_={})

    # 生成AI（gemini_free。gemini/claude/openaiは上記ゲートにより現状ここへは到達しない）。
    # PDFがある場合はマルチモーダル入力として直接添付し、PyMuPDF/Docling経由の事前変換は
    # 行わない（ADR-015）。PDFConversionError・AIGenerationErrorはここで捕捉せず、送出のみ行う
    # （ADR-012）。
    pdf_bytes: Optional[bytes] = None
    if pdf is not None:
        pdf_bytes = await pdf.read()

    prompt_text = build_prompt(
        prompt=prompt, width_mm=width_mm, height_mm=height_mm, has_pdf=pdf_bytes is not None
    )

    ai_client = ai_client_factory(engine)
    result = await asyncio.to_thread(ai_client.generate, prompt_text, pdf_bytes)
    validate_render_result(result)

    _save_history(
        db_session,
        current_user,
        engine=engine,
        html=result.html,
        css=result.css,
        json_data=result.data,
        width_mm=width_mm,
        height_mm=height_mm,
    )
    return RenderResponse(html=result.html, css=result.css, json_=result.data)


def _save_history(
    db_session: Optional[Session],
    current_user: Optional[SupabaseUser],
    *,
    engine: str,
    html: str,
    css: str,
    json_data: dict,
    width_mm: Optional[float],
    height_mm: Optional[float],
) -> None:
    """描画成功時に生成履歴を自動保存する（DEVELOPMENT.md ステップ28）。

    未ログイン・DB未設定（db_session is None）では何もしない。DB保存の失敗は描画結果の
    レスポンスへ波及させない（描画自体は成功しているため、ユーザーへは成功として返す）。
    """
    if db_session is None or current_user is None:
        return
    try:
        save_history(
            db_session,
            user_id=current_user.sub,
            engine=engine,
            html=html,
            css=css,
            json_data=json_data,
            width_mm=width_mm,
            height_mm=height_mm,
        )
    except Exception:
        logger.warning("生成履歴の保存に失敗しました", exc_info=True)


class HistoryItemResponse(BaseModel):
    """GET /api/historyの1件分（docs/spec.md 3.x、DEVELOPMENT.md ステップ28）。"""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    engine: str
    html: str
    css: str
    json_: dict = Field(default_factory=dict, alias="json")
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    # "render"（描画結果）か "edit"（編集中スナップショット）か。
    kind: str = "render"
    created_at: str


class HistoryEditRequest(BaseModel):
    """POST /api/history/editのリクエスト。描画を経ない編集中スナップショットの保存に使う。"""

    model_config = ConfigDict(populate_by_name=True)

    engine: str = "gemini_free"
    html: str = ""
    css: str = ""
    json_: dict = Field(default_factory=dict, alias="json")
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None


def _to_history_response(row) -> HistoryItemResponse:
    return HistoryItemResponse(
        id=str(row.id),
        engine=row.engine,
        html=row.html,
        css=row.css,
        json=row.json_data,
        width_mm=row.width_mm,
        height_mm=row.height_mm,
        kind=row.kind,
        created_at=row.created_at.isoformat(),
    )


@app.get("/api/history", response_model=list[HistoryItemResponse], response_model_by_alias=True)
def get_history(
    current_user: Optional[SupabaseUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> list[HistoryItemResponse]:
    # /api/renderのGATED_ENGINESと同じ判定（未ログインは403 FREE_ACCESS_FORBIDDEN。docs/spec.md 4章）。
    if current_user is None:
        raise HTTPException(status_code=403)

    rows = list_history(db_session, user_id=current_user.sub)
    return [_to_history_response(row) for row in rows]


@app.post(
    "/api/history/edit",
    response_model=HistoryItemResponse,
    response_model_by_alias=True,
    status_code=201,
)
def create_edit_history(
    payload: HistoryEditRequest,
    current_user: Optional[SupabaseUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> HistoryItemResponse:
    if current_user is None:
        raise HTTPException(status_code=403)

    row = save_history(
        db_session,
        user_id=current_user.sub,
        engine=payload.engine,
        html=payload.html,
        css=payload.css,
        json_data=payload.json_,
        width_mm=payload.width_mm,
        height_mm=payload.height_mm,
        kind="edit",
    )
    return _to_history_response(row)


async def _convert_with_engine(
    engine: str,
    layout_converter: PDFLayoutConverter,
    html_extractor: DoclingHtmlExtractor,
    pdf2htmlex_extractor: Pdf2HtmlExExtractor,
    filename: str,
    content: bytes,
) -> str:
    """変換エンジン（docling/pdf2htmlex/pymupdf）ごとにPDF→HTML変換を行う（ADR-015）。

    いずれもAIを介さず、変換結果をそのまま描画結果として返す単独のエンジン。
    """
    if engine == "pymupdf":
        return await asyncio.to_thread(layout_converter.convert_to_html, filename, content)
    if engine == "docling":
        return await asyncio.to_thread(html_extractor.convert_to_html, filename, content)
    return await asyncio.to_thread(pdf2htmlex_extractor.convert_to_html, filename, content)
