"""API通信の構造化エラーレスポンス。

エラー応答を `{"error": {"code", "message", "request_id"}}` のエンベロープへ統一する。
生の例外メッセージ（英語・内部情報を含みうる）はサーバーログにのみ残し、レスポンスへは漏らさない。
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable, cast

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.request_context import get_request_id
from app.services.ai_client import (
    AIGenerationError,
    AIServiceSuspendedError,
    AIServiceUnavailableError,
)
from app.services.pdf_common import PDFConversionError

logger = logging.getLogger("app.errors")

# ステータス→(code, 安全な日本語文言)。文言はフロントの静的フォールバック
# （frontend/src/store/sheetStore.ts）と揃え、バックエンドを一次ソースとする。
_ERROR_CATALOG: dict[int, tuple[str, str]] = {
    400: ("VALIDATION_ERROR", "リクエスト内容に誤りがあります。入力値をご確認ください。"),
    403: (
        "FREE_ACCESS_FORBIDDEN",
        "この生成AIは登録ユーザーのみご利用いただけます。Googleアカウントでログインしてお試しください。",
    ),
    413: ("PAYLOAD_TOO_LARGE", "PDFファイルのサイズが上限を超えています。"),
    # PDF未添付は入力誤り一般（400）と区別し、対処が分かる専用の文言にする。
    428: ("PDF_REQUIRED", "このエンジンを使うにはPDFファイルの添付が必要です。ファイルを選択してください。"),
    422: ("PDF_CONVERSION_ERROR", "PDFの解析に失敗しました。ファイルの内容をご確認ください。"),
    429: ("RATE_LIMITED", "リクエストが混み合っています。しばらくしてから再度お試しください。"),
    502: ("AI_GENERATION_ERROR", "AIによる生成に失敗しました。しばらくしてから再度お試しください。"),
    503: (
        "AI_SERVICE_UNAVAILABLE",
        "生成AIサービスが混雑しています。しばらく時間をおいて再度お試しください。",
    ),
    501: ("AI_SERVICE_SUSPENDED", "現在、利用停止中です。"),
    500: ("INTERNAL_ERROR", "サーバーで想定外のエラーが発生しました。"),
}

# カタログに無いステータスでもcode/statusの齟齬が起きないようにするための保険。
_FALLBACK = ("HTTP_ERROR", "エラーが発生しました。")


def build_error_payload(status_code: int) -> dict:
    """ステータスコードから構造化エラーボディを組み立てる。"""
    code, message = _ERROR_CATALOG.get(status_code, _FALLBACK)
    return {
        "error": {
            "code": code,
            "message": message,
            # リクエスト外（ミドルウェア未通過）から呼ばれた場合は空文字にする。
            "request_id": get_request_id() or "",
        }
    }


def error_response(status_code: int) -> JSONResponse:
    """構造化エラーボディを持つJSONResponseを返す。X-Request-IDヘッダーはミドルウェアが付与する。"""
    return JSONResponse(status_code=status_code, content=build_error_payload(status_code))


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """HTTPExceptionを構造化エラーへ変換する。生のdetailはレスポンスに出さずログにのみ残す。"""
    # Starletteはハンドラを例外型で引くため、登録した型で届くことは呼び出し側が保証する。
    http_exc = cast(StarletteHTTPException, exc)
    logger.warning(
        "HTTPException",
        extra={"status_code": http_exc.status_code, "detail": str(http_exc.detail), "request_id": get_request_id()},
    )
    return error_response(http_exc.status_code)


async def validation_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """リクエストバリデーション失敗を400へ寄せる。

    FastAPI既定は422だが、本APIでは422をPDF解析エラー専用に割り当てているため、
    入力バリデーションは400 VALIDATION_ERRORへ統一する。
    """
    logger.warning(
        "RequestValidationError",
        extra={
            "status_code": 400,
            "detail": str(cast(RequestValidationError, exc).errors()),
            "request_id": get_request_id(),
        },
    )
    return error_response(400)


def _domain_error_handler(
    status_code: int, log_message: str
) -> Callable[[Request, Exception], Awaitable[JSONResponse]]:
    """ドメイン例外→構造化エラーのハンドラを生成する。

    例外種別ごとの違いはステータスとログ文言だけなので、ハンドラ本体を型ごとに書き分けない。
    """

    async def handler(request: Request, exc: Exception) -> JSONResponse:
        logger.warning("%s: %s", log_message, exc, extra={"status_code": status_code, "request_id": get_request_id()})
        return error_response(status_code)

    return handler


# ドメイン例外→(ステータス, ログ文言)の唯一の対応表。例外ハンドラを通る同期経路と、
# ハンドラを通らない非同期ジョブ経路（status_code_for）の双方がここだけを参照する。
# サブクラスを先に置き、status_code_forは最初に一致した行を採る。
_DOMAIN_ERRORS: tuple[tuple[type[Exception], int, str], ...] = (
    (PDFConversionError, 422, "PDF conversion failed"),
    (AIServiceUnavailableError, 503, "AI service unavailable"),
    (AIServiceSuspendedError, 501, "AI service suspended"),
    (AIGenerationError, 502, "AI generation failed"),
)

# ドメイン例外はmain.py内でHTTPExceptionへ変換せず、送出のみ行いここで一元的に整形する。
# Starletteのハンドラ探索はMRO順のため、登録順に関わらずサブクラス側が優先される。
DOMAIN_ERROR_HANDLERS: dict[type[Exception], Callable[[Request, Exception], Awaitable[JSONResponse]]] = {
    exc_type: _domain_error_handler(status_code, log_message) for exc_type, status_code, log_message in _DOMAIN_ERRORS
}


def status_code_for(exc: Exception) -> int:
    """ドメイン例外に対応するHTTPステータスを返す。表に無い例外は500へ落とす。

    例外ハンドラが働かない経路（非同期レンダリングジョブ）でも、同期経路と同じ対応表を引くための入口。
    """
    for exc_type, status_code, _ in _DOMAIN_ERRORS:
        if isinstance(exc, exc_type):
            return status_code
    return 500
