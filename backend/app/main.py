import asyncio
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, UploadFile
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
from app.services.docling_client import PDFMarkdownExtractor, get_markdown_extractor
from app.services.pdf2htmlex_client import PDFLayoutConverter, get_layout_converter
from app.services.pdf_common import PDFConversionError

# アプリ生成前に設定し、起動〜リクエスト処理まで一貫してJSON構造化ログにする（ADR-016）。
configure_logging()

app = FastAPI()

# リクエスト相関ID採番・アクセスログ・想定外例外の500化（ADR-016/017）。
app.add_middleware(RequestContextMiddleware)

# 例外→構造化エラーレスポンスの整形はハンドラへ集約する（ADR-017）。StarletteHTTPExceptionで
# 登録することで、FastAPI/Starlette双方のHTTPExceptionを捕捉する。
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(PDFConversionError, pdf_conversion_error_handler)
app.add_exception_handler(AIGenerationError, ai_generation_error_handler)


# response_modelを明示しないと、FastAPIが型を推論できずopenapi.json（フロントの型生成元。ADR-006）の
# レスポンススキーマがobject止まりになる。
class RenderResponse(BaseModel):
    # Python予約語と衝突する`json`キー名をエイリアスとして公開する（docs/spec.md 3.1のレスポンス例）。
    model_config = ConfigDict(populate_by_name=True)

    html: str
    css: str
    json_: dict = Field(default_factory=dict, alias="json")


@app.post("/api/render", response_model=RenderResponse, response_model_by_alias=True)
async def render(
    html: str = Form(""),
    # セキュリティ対策: promptはプロンプトインジェクションの温床になり得る自由入力のため、
    # フロント（PromptInput.tsxのmaxLength）と合わせて長さを二重に制限する。超過時は
    # RequestValidationError経由でapp/errors.pyが400 VALIDATION_ERRORへ変換する。
    prompt: str = Form("", max_length=100),
    width_mm: Optional[float] = Form(None),
    height_mm: Optional[float] = Form(None),
    pdf: Optional[UploadFile] = File(None),
    # Dependsで注入することで、テスト側がdependency_overridesにより成功/失敗や高速なフェイクへ
    # 差し替えられるようにする（ADR-007）。
    ai_client: AIClient = Depends(get_ai_client),
    markdown_extractor: PDFMarkdownExtractor = Depends(get_markdown_extractor),
    layout_converter: PDFLayoutConverter = Depends(get_layout_converter),
) -> RenderResponse:
    # PDFがある場合は、pdf2htmlEXのレイアウトHTML（見た目）とDoclingのMarkdown（テキスト）の
    # 両方をプロンプトのベースにする（ADR-023、docs/architecture.md 2節のシーケンス図）。
    # PDFConversionError・AIGenerationErrorはここで捕捉せず、送出のみ行う（ADR-017）。
    effective_html = html
    markdown = ""
    if pdf is not None:
        content = await pdf.read()
        filename = pdf.filename or "uploaded.pdf"
        effective_html, markdown = await _convert_pdf(
            layout_converter, markdown_extractor, filename, content
        )

    prompt_text = build_prompt(
        html=effective_html,
        markdown=markdown,
        prompt=prompt,
        width_mm=width_mm,
        height_mm=height_mm,
    )

    result = await asyncio.to_thread(ai_client.generate, prompt_text)
    validate_render_result(result)

    return RenderResponse(html=result.html, css=result.css, json_=result.data)


async def _convert_pdf(
    layout_converter: PDFLayoutConverter,
    markdown_extractor: PDFMarkdownExtractor,
    filename: str,
    content: bytes,
) -> tuple:
    """pdf2htmlEX（レイアウトHTML）とDocling（Markdown）を並列に実行する（ADR-023）。

    どちらも秒単位（Doclingは初回モデルロードで分単位）かかるため、直列に呼ぶと待ち時間が
    単純に加算される。クライアント実装は同期I/O（httpx.Client）のため、スレッドへ逃がして
    asyncio.gatherで並列化する。
    """
    return await asyncio.gather(
        asyncio.to_thread(layout_converter.convert_to_html, filename, content),
        asyncio.to_thread(markdown_extractor.convert_to_markdown, filename, content),
    )
