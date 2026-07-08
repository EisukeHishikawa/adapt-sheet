"""API通信の構造化エラーレスポンス設計（ADR-017、DEVELOPMENT.md ステップ14）。

エラー応答を `{"error": {"code", "message", "request_id"}}` の一貫したエンベロープへ統一する。
- code: 機械可読な識別子（フロントの分岐にも使える）
- message: ユーザーへ表示する安全な日本語文言（生の例外メッセージは載せない）
- request_id: ADR-016で採番した相関ID（X-Request-IDヘッダー・サーバーログと同値）

生の例外メッセージ（英語・内部情報を含みうる）はサーバーログにのみ残し、
レスポンスには漏らさないことで、情報漏えいなくユーザーへ状況を伝える。
"""

from __future__ import annotations

import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.request_context import get_request_id
from app.services.ai_client import AIGenerationError
from app.services.docling_client import PDFConversionError

logger = logging.getLogger("app.errors")

# docs/spec.md 4章のエラーコード定義と1対1で対応させる。ステータス→(code, 安全な日本語文言)。
# フロントの静的フォールバック（frontend/src/store/sheetStore.ts messageForStatus）と
# 同じ文言に揃え、バックエンドを「文言の一次ソース」としつつ齟齬が出ないようにする。
_ERROR_CATALOG: dict[int, tuple[str, str]] = {
    400: ("VALIDATION_ERROR", "リクエスト内容に誤りがあります。入力値をご確認ください。"),
    413: ("PAYLOAD_TOO_LARGE", "PDFファイルのサイズが上限を超えています。"),
    422: ("PDF_CONVERSION_ERROR", "PDFの解析に失敗しました。ファイルの内容をご確認ください。"),
    429: ("RATE_LIMITED", "リクエストが混み合っています。しばらくしてから再度お試しください。"),
    502: ("AI_GENERATION_ERROR", "AIによる生成に失敗しました。しばらくしてから再度お試しください。"),
    500: ("INTERNAL_ERROR", "サーバーで想定外のエラーが発生しました。"),
}

# カタログに無いステータス（想定外）のときの既定。code/statusの齟齬を避けるための保険。
_FALLBACK = ("HTTP_ERROR", "エラーが発生しました。")


def build_error_payload(status_code: int) -> dict:
    """ステータスコードから構造化エラーボディを組み立てる（docs/spec.md 4.1）。"""
    code, message = _ERROR_CATALOG.get(status_code, _FALLBACK)
    return {
        "error": {
            "code": code,
            "message": message,
            # 相関IDはミドルウェアがcontextvarへ設定済み。リクエスト外の万一のケースでは空文字にする。
            "request_id": get_request_id() or "",
        }
    }


def error_response(status_code: int) -> JSONResponse:
    """構造化エラーボディを持つJSONResponseを返す。X-Request-IDヘッダーはミドルウェアが付与する。"""
    return JSONResponse(status_code=status_code, content=build_error_payload(status_code))


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """HTTPException（主にバリデーションの400等）を構造化エラーへ変換する。

    生のdetail（原因の技術詳細）はレスポンスには出さず、調査用にサーバーログへ残す。
    """
    logger.warning(
        "HTTPException",
        extra={"status_code": exc.status_code, "detail": str(exc.detail), "request_id": get_request_id()},
    )
    return error_response(exc.status_code)


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPIのリクエストバリデーション失敗を、docs/spec.md 4章に合わせ400へ寄せる。

    FastAPI既定は422だが、本APIでは422をDocling解析エラー専用に割り当てているため、
    型不正等の入力バリデーションは400 VALIDATION_ERRORへ統一する。
    """
    logger.warning(
        "RequestValidationError",
        extra={"status_code": 400, "detail": str(exc.errors()), "request_id": get_request_id()},
    )
    return error_response(400)


async def pdf_conversion_error_handler(request: Request, exc: PDFConversionError) -> JSONResponse:
    """Docling解析エラー→422（docs/spec.md 4章）。整形をハンドラへ集約する（ADR-017）。"""
    logger.warning("PDF conversion failed: %s", exc, extra={"status_code": 422, "request_id": get_request_id()})
    return error_response(422)


async def ai_generation_error_handler(request: Request, exc: AIGenerationError) -> JSONResponse:
    """AI生成エラー→502（docs/spec.md 4章）。整形をハンドラへ集約する（ADR-017）。"""
    logger.warning("AI generation failed: %s", exc, extra={"status_code": 502, "request_id": get_request_id()})
    return error_response(502)
