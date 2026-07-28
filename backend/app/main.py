import asyncio
import logging
from datetime import date
from typing import Callable, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.db import db_session_for_user, get_db_pinger, get_db_session, get_db_session_or_none
from app.errors import (
    ai_generation_error_handler,
    build_error_payload,
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
    RenderResult,
    build_hybrid_prompt,
    build_prompt,
    get_ai_client_factory,
    validate_render_result,
)
from app.services.docling_client import PDFHtmlExtractor as DoclingHtmlExtractor, get_html_extractor
from app.services.gemini_usage import (
    GEMINI_FREE_DAILY_LIMIT,
    GEMINI_FREE_QUOTA_ENGINES,
    get_gemini_free_usage,
    record_gemini_free_usage,
)
from app.services.history import list_history, save_history, update_edit_history
from app.services.job_store import JobStore, get_job_store
from app.services.pdf2htmlex_client import (
    PDFHtmlExtractor as Pdf2HtmlExExtractor,
    get_pdf2htmlex_extractor,
)
from app.services.pdf_layout import PDFLayoutConverter, get_layout_converter
from app.services.pdf_common import PDFConversionError
from app.services.worker_invoker import WorkerInvoker, get_worker_invoker

logger = logging.getLogger("app.history")
warmup_logger = logging.getLogger("app.warmup")

# アプリ生成前に設定し、起動〜リクエスト処理まで一貫してJSON構造化ログにする。
configure_logging()

# Lambdaのコールドスタート時（このモジュールのimport）に一度だけParameter StoreからAPIキーを
# os.environへ展開する。ハンドラ内で毎リクエストSSMを叩かないための鉄則。
# SSM_PARAMETER_PREFIX未設定のローカル/pytestでは no-op。
load_secrets_into_env()

app = FastAPI()

# リクエスト相関ID採番・アクセスログ・想定外例外の500化を行うミドルウェア。
app.add_middleware(RequestContextMiddleware)

# 例外→構造化エラーレスポンスの整形はハンドラへ集約する。StarletteHTTPExceptionで
# 登録することで、FastAPI/Starlette双方のHTTPExceptionを捕捉する。
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(PDFConversionError, pdf_conversion_error_handler)
app.add_exception_handler(AIGenerationError, ai_generation_error_handler)


# response_modelを明示しないと、FastAPIが型を推論できずopenapi.json（フロントの型生成元）の
# レスポンススキーマがobject止まりになる。
class RenderResponse(BaseModel):
    # Python予約語と衝突する`json`キー名をエイリアスとして公開する。
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
    # フロント（EngineSelect）が選択した生成エンジン。7値のいずれか。
    engine: str = Form("gemini_free"),
    pdf: Optional[UploadFile] = File(None),
    # PDFが無い生成AIリクエストで、現在画面に表示中のHTML/CSSとJSONを送るための項目
    # （build_promptがhas_pdf=False時にのみ使う。ai_client.build_prompt参照）。
    current_html: str = Form(""),
    current_json: str = Form(""),
    # Dependsで注入することで、テスト側がdependency_overridesにより成功/失敗や高速なフェイクへ
    # 差し替えられるようにする。ai_client_factoryはengineがリクエスト時にしか
    # 決まらないため、AIClientインスタンスではなく関数を注入する。
    ai_client_factory: Callable[[str], AIClient] = Depends(get_ai_client_factory),
    layout_converter: PDFLayoutConverter = Depends(get_layout_converter),
    html_extractor: DoclingHtmlExtractor = Depends(get_html_extractor),
    pdf2htmlex_extractor: Pdf2HtmlExExtractor = Depends(get_pdf2htmlex_extractor),
    current_user: Optional[SupabaseUser] = Depends(get_current_user),
    db_session: Optional[Session] = Depends(get_db_session_or_none),
) -> RenderResponse:
    # 標準プランの生成AI（Gemini標準/Claude/OpenAI）はログイン済みユーザーのみに提供する。
    # PDF処理・AI呼び出しより前に判定し、無駄な処理を避ける。
    if engine in GATED_ENGINES and current_user is None:
        raise HTTPException(status_code=403)

    if engine in CONVERTER_ENGINES:
        # Docling/pdf2htmlEX/PyMuPDFはAIを介さず、変換結果をそのまま描画結果にする。PDF必須。
        if pdf is None:
            raise HTTPException(status_code=428)
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

    # 生成AI（hybrid/gemini_free。gemini/claude/openaiは上記ゲートにより未ログインでは
    # 到達しない）。PDFConversionError・AIGenerationErrorはここで捕捉せず、送出のみ行う。
    pdf_bytes: Optional[bytes] = None
    filename = "uploaded.pdf"
    if pdf is not None:
        pdf_bytes = await pdf.read()
        filename = pdf.filename or filename

    result = await _generate_ai_result(
        engine=engine,
        pdf_bytes=pdf_bytes,
        filename=filename,
        prompt=prompt,
        width_mm=width_mm,
        height_mm=height_mm,
        current_html=current_html,
        current_json=current_json,
        ai_client_factory=ai_client_factory,
        layout_converter=layout_converter,
        html_extractor=html_extractor,
    )

    if engine in GEMINI_FREE_QUOTA_ENGINES:
        _record_gemini_free_usage(db_session)

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


async def _generate_ai_result(
    *,
    engine: str,
    pdf_bytes: Optional[bytes],
    filename: str,
    prompt: str,
    width_mm: Optional[float],
    height_mm: Optional[float],
    current_html: str,
    current_json: str,
    ai_client_factory: Callable[[str], AIClient],
    layout_converter: PDFLayoutConverter,
    html_extractor: DoclingHtmlExtractor,
) -> RenderResult:
    """生成AI（hybrid/gemini_free/gemini/claude/openai）でHTML/CSS/JSONを生成する。

    `/api/render`（同期）と非同期ワーカー（`POST /internal/render-jobs/process`）の
    両方から呼ばれる共通ロジック。engine=hybridのみPDF必須でPyMuPDF・Doclingの
    抽出結果も使う。PDFがある場合はマルチモーダル入力として直接添付する
    （PyMuPDF/Docling経由の事前変換はhybrid以外では行わない）。
    """
    if engine == "hybrid":
        # PyMuPDF（正確なフォントサイズ・位置）とDocling（表・段落構造）の変換結果を、
        # PDF本体と一緒にGemini（VLM）へ渡して1つのHTML/CSS/JSONへ統合させる。PDF添付必須。
        if pdf_bytes is None:
            raise HTTPException(status_code=428)
        pymupdf_html, docling_html = await asyncio.gather(
            asyncio.to_thread(layout_converter.convert_to_html, filename, pdf_bytes),
            asyncio.to_thread(html_extractor.convert_to_html, filename, pdf_bytes),
        )
        prompt_text = build_hybrid_prompt(
            prompt=prompt,
            width_mm=width_mm,
            height_mm=height_mm,
            pymupdf_html=pymupdf_html,
            docling_html=docling_html,
        )
        ai_client = ai_client_factory(engine)
        result = await asyncio.to_thread(ai_client.generate, prompt_text, pdf_bytes)
        validate_render_result(result)
        return result

    prompt_text = build_prompt(
        prompt=prompt,
        width_mm=width_mm,
        height_mm=height_mm,
        has_pdf=pdf_bytes is not None,
        current_html=current_html,
        current_json=current_json,
    )
    ai_client = ai_client_factory(engine)
    result = await asyncio.to_thread(ai_client.generate, prompt_text, pdf_bytes)
    validate_render_result(result)
    return result


class UploadUrlResponse(BaseModel):
    job_id: str
    upload_url: str


@app.post("/api/render/upload-url", response_model=UploadUrlResponse)
def create_upload_url(job_store: JobStore = Depends(get_job_store)) -> UploadUrlResponse:
    """PDFをbackendを経由せずS3へ直接アップロードするための署名付きURLを発行する。

    生成AIエンジン（POST /api/render/jobs）向け。発行したjob_idをその後のジョブ起動と
    紐付けるために使う。
    """
    job_id = job_store.new_job_id()
    return UploadUrlResponse(job_id=job_id, upload_url=job_store.presigned_upload_url(job_id))


class RenderJobRequest(BaseModel):
    prompt: str = Field("", max_length=100)
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    engine: str = "gemini_free"
    current_html: str = ""
    current_json: str = ""
    # POST /api/render/upload-urlで発行したjob_id。PDFを使わない場合は未指定でよい。
    job_id: Optional[str] = None
    has_pdf: bool = False


class RenderJobResponse(BaseModel):
    job_id: str


@app.post("/api/render/jobs", response_model=RenderJobResponse, status_code=202)
def create_render_job(
    payload: RenderJobRequest,
    current_user: Optional[SupabaseUser] = Depends(get_current_user),
    job_store: JobStore = Depends(get_job_store),
    worker_invoker: WorkerInvoker = Depends(get_worker_invoker),
) -> RenderJobResponse:
    """生成AIエンジン（hybrid/gemini_free/gemini/claude/openai）のレンダリングを
    非同期ジョブとして起動する。

    Gemini API自体がGoogle側の事情で20〜30秒以上かかる・504を返すことがあり、
    API Gatewayの統合タイムアウト（29秒固定）に収まらない。実処理はrender-worker
    Lambdaへ非同期起動（lambda:invoke Event、API Gatewayを経由しないため29秒制約を
    受けない）し、ここではジョブIDだけを即座に返す。ゲート判定は/api/renderと同じく
    ここで同期的に行う。
    """
    if payload.engine in GATED_ENGINES and current_user is None:
        raise HTTPException(status_code=403)

    job_id = payload.job_id or job_store.new_job_id()
    job_store.write_status(job_id, {"status": "pending"})

    worker_invoker.invoke(
        "/internal/render-jobs/process",
        {
            "job_id": job_id,
            "engine": payload.engine,
            "prompt": payload.prompt,
            "width_mm": payload.width_mm,
            "height_mm": payload.height_mm,
            "current_html": payload.current_html,
            "current_json": payload.current_json,
            "has_pdf": payload.has_pdf,
            "user_id": current_user.sub if current_user is not None else None,
        },
    )
    return RenderJobResponse(job_id=job_id)


class RenderJobStatusResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: str
    html: Optional[str] = None
    css: Optional[str] = None
    json_: Optional[dict] = Field(default=None, alias="json")
    message: Optional[str] = None


@app.get(
    "/api/render/jobs/{job_id}",
    response_model=RenderJobStatusResponse,
    response_model_by_alias=True,
)
def get_render_job(
    job_id: str, job_store: JobStore = Depends(get_job_store)
) -> RenderJobStatusResponse:
    status = job_store.read_status(job_id)
    if status is None:
        raise HTTPException(status_code=404)
    return RenderJobStatusResponse(
        status=status.get("status", "error"),
        html=status.get("html"),
        css=status.get("css"),
        json=status.get("json"),
        message=status.get("message"),
    )


class RenderJobProcessRequest(BaseModel):
    job_id: str
    engine: str
    prompt: str = ""
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    current_html: str = ""
    current_json: str = ""
    has_pdf: bool = False
    user_id: Optional[str] = None


@app.post("/internal/render-jobs/process", status_code=202)
async def process_render_job(
    payload: RenderJobProcessRequest,
    ai_client_factory: Callable[[str], AIClient] = Depends(get_ai_client_factory),
    layout_converter: PDFLayoutConverter = Depends(get_layout_converter),
    html_extractor: DoclingHtmlExtractor = Depends(get_html_extractor),
    job_store: JobStore = Depends(get_job_store),
) -> dict:
    """render-workerが処理する非同期レンダリングジョブの実体。

    API Gateway/Function URLを経由せず、backendからのlambda:invoke（Event、合成した
    API Gatewayプロキシ形式のイベント）でのみ到達する。IAMレベルで既に外部から
    呼び出せない（docling/pdf2htmlexと異なりresource-based policyは不要）。
    """
    try:
        pdf_bytes = job_store.fetch_uploaded_pdf(payload.job_id) if payload.has_pdf else None
        result = await _generate_ai_result(
            engine=payload.engine,
            pdf_bytes=pdf_bytes,
            filename="uploaded.pdf",
            prompt=payload.prompt,
            width_mm=payload.width_mm,
            height_mm=payload.height_mm,
            current_html=payload.current_html,
            current_json=payload.current_json,
            ai_client_factory=ai_client_factory,
            layout_converter=layout_converter,
            html_extractor=html_extractor,
        )
    except HTTPException as exc:
        message = build_error_payload(exc.status_code)["error"]["message"]
        job_store.write_status(payload.job_id, {"status": "error", "message": message})
        return {"status": "error"}
    except (PDFConversionError, AIGenerationError) as exc:
        job_store.write_status(payload.job_id, {"status": "error", "message": str(exc)})
        return {"status": "error"}
    except Exception:
        logger.exception(
            "非同期レンダリングジョブの処理に失敗しました", extra={"job_id": payload.job_id}
        )
        job_store.write_status(
            payload.job_id,
            {"status": "error", "message": "サーバーで想定外のエラーが発生しました。"},
        )
        return {"status": "error"}

    job_store.write_status(
        payload.job_id,
        {"status": "done", "html": result.html, "css": result.css, "json": result.data},
    )

    # gemini_free/hybridは未ログインでも使えるため、履歴保存（ログイン時のみ）とは別に
    # user_idの有無に関わらずカウンタ更新が必要かどうかでセッションを開く。
    if payload.engine in GEMINI_FREE_QUOTA_ENGINES or payload.user_id is not None:
        with db_session_for_user(payload.user_id) as db_session:
            if payload.engine in GEMINI_FREE_QUOTA_ENGINES:
                _record_gemini_free_usage(db_session)
            if payload.user_id is not None:
                _save_history(
                    db_session,
                    SupabaseUser(sub=payload.user_id, email=None),
                    engine=payload.engine,
                    html=result.html,
                    css=result.css,
                    json_data=result.data,
                    width_mm=payload.width_mm,
                    height_mm=payload.height_mm,
                )

    return {"status": "done"}


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
    """描画成功時に生成履歴を自動保存する。

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


def _record_gemini_free_usage(db_session: Optional[Session]) -> None:
    """gemini_free描画成功時にカウンタを更新する。未ログインでもカウント対象のため
    current_userの有無は問わない。DB保存の失敗は描画結果のレスポンスへ波及させない。"""
    if db_session is None:
        return
    try:
        record_gemini_free_usage(db_session)
    except Exception:
        logger.warning("Gemini無料枠の利用回数記録に失敗しました", exc_info=True)


class GeminiFreeUsageResponse(BaseModel):
    date: str
    count: int
    limit: int


@app.get("/api/usage/gemini-free", response_model=GeminiFreeUsageResponse)
def get_gemini_free_usage_status(
    db_session: Optional[Session] = Depends(get_db_session_or_none),
) -> GeminiFreeUsageResponse:
    """Gemini無料枠（gemini_free）の当日利用回数。認証不要（匿名利用も対象のため）。"""
    if db_session is None:
        return GeminiFreeUsageResponse(
            date=date.today().isoformat(), count=0, limit=GEMINI_FREE_DAILY_LIMIT
        )

    status = get_gemini_free_usage(db_session)
    return GeminiFreeUsageResponse(
        date=status.date.isoformat(), count=status.count, limit=status.limit
    )


class HistoryItemResponse(BaseModel):
    """GET /api/historyの1件分。"""

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
    # /api/renderのGATED_ENGINESと同じ判定（未ログインは403 FREE_ACCESS_FORBIDDEN）。
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


@app.put(
    "/api/history/edit/{entry_id}",
    response_model=HistoryItemResponse,
    response_model_by_alias=True,
)
def update_edit_history_entry(
    entry_id: str,
    payload: HistoryEditRequest,
    current_user: Optional[SupabaseUser] = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> HistoryItemResponse:
    if current_user is None:
        raise HTTPException(status_code=403)

    row = update_edit_history(
        db_session,
        entry_id=entry_id,
        user_id=current_user.sub,
        engine=payload.engine,
        html=payload.html,
        css=payload.css,
        json_data=payload.json_,
        width_mm=payload.width_mm,
        height_mm=payload.height_mm,
    )
    if row is None:
        raise HTTPException(status_code=404)
    return _to_history_response(row)


class WarmupResponse(BaseModel):
    """各対象の結果は"ok" / "unavailable"のいずれか。"""

    docling: str
    pdf2htmlex: str
    database: str


@app.post("/api/warmup", response_model=WarmupResponse)
async def warmup(
    html_extractor: DoclingHtmlExtractor = Depends(get_html_extractor),
    pdf2htmlex_extractor: Pdf2HtmlExExtractor = Depends(get_pdf2htmlex_extractor),
    db_pinger: Callable[[], bool] = Depends(get_db_pinger),
) -> WarmupResponse:
    """フロント表示時に呼ばれるホットスタンバイ用エンドポイント。

    docling/pdf2htmlexはIAM認証必須のLambda Function URLでフロントから直接
    叩けないため、backendが署名付きで代理ピングする。あわせてSupabaseのDBへも最小クエリを
    投げ、無操作による一時停止を避ける。認証は要求しない（画面を開いた時点で投げるため）。

    結果は画面の挙動を左右しないため、どれが失敗しても常に200を返す。
    """
    docling_ok, pdf2htmlex_ok, database_ok = await asyncio.gather(
        asyncio.to_thread(_safe_warmup, html_extractor.warmup, "docling"),
        asyncio.to_thread(_safe_warmup, pdf2htmlex_extractor.warmup, "pdf2htmlex"),
        asyncio.to_thread(_safe_warmup, db_pinger, "database"),
    )
    return WarmupResponse(
        docling=_warmup_status(docling_ok),
        pdf2htmlex=_warmup_status(pdf2htmlex_ok),
        database=_warmup_status(database_ok),
    )


def _safe_warmup(ping: Callable[[], bool], target: str) -> bool:
    try:
        return bool(ping())
    except Exception:
        warmup_logger.warning("ウォームアップに失敗しました: %s", target, exc_info=True)
        return False


def _warmup_status(ok: bool) -> str:
    return "ok" if ok else "unavailable"


async def _convert_with_engine(
    engine: str,
    layout_converter: PDFLayoutConverter,
    html_extractor: DoclingHtmlExtractor,
    pdf2htmlex_extractor: Pdf2HtmlExExtractor,
    filename: str,
    content: bytes,
) -> str:
    """変換エンジン（docling/pdf2htmlex/pymupdf）ごとにPDF→HTML変換を行う。

    いずれもAIを介さず、変換結果をそのまま描画結果として返す単独のエンジン。
    """
    if engine == "pymupdf":
        return await asyncio.to_thread(layout_converter.convert_to_html, filename, content)
    if engine == "docling":
        return await asyncio.to_thread(html_extractor.convert_to_html, filename, content)
    return await asyncio.to_thread(pdf2htmlex_extractor.convert_to_html, filename, content)
