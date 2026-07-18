"""API通信の構造化エラーレスポンス（ADR-013）。

エラー応答を `{"error": {"code", "message", "request_id"}}` のエンベロープへ統一する。
生の例外メッセージ（英語・内部情報を含みうる）はサーバーログにのみ残し、レスポンスへは漏らさない。
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.request_context import get_request_id

logger = logging.getLogger("app.errors")

# docs/spec.md 4章のエラーコード定義と1対1で対応させる。ステータス→(code, 安全な日本語文言)。
# 文言はフロントの静的フォールバック（frontend/src/store/sheetStore.ts）と揃え、バックエンドを
# 一次ソースとしつつ齟齬が出ないようにする。
_ERROR_CATALOG: dict[int, tuple[str, str]] = {
    400: ("VALIDATION_ERROR", "リクエスト内容に誤りがあります。入力値をご確認ください。"),
    403: (
        "FREE_ACCESS_FORBIDDEN",
        "現在、この生成AIは登録ユーザーのみご利用いただけます。アカウント機能の追加までお待ちください。",
    ),
    413: ("PAYLOAD_TOO_LARGE", "PDFファイルのサイズが上限を超えています。"),
    422: ("PDF_CONVERSION_ERROR", "PDFの解析に失敗しました。ファイルの内容をご確認ください。"),
    429: ("RATE_LIMITED", "リクエストが混み合っています。しばらくしてから再度お試しください。"),
    502: ("AI_GENERATION_ERROR", "AIによる生成に失敗しました。しばらくしてから再度お試しください。"),
    500: ("INTERNAL_ERROR", "サーバーで想定外のエラーが発生しました。"),
}

# カタログに無いステータスでもcode/statusの齟齬が起きないようにするための保険。
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
    """HTTPExceptionを構造化エラーへ変換する。生のdetailはレスポンスに出さずログにのみ残す。"""
    logger.warning(
        "HTTPException",
        extra={"status_code": exc.status_code, "detail": str(exc.detail), "request_id": get_request_id()},
    )
    return error_response(exc.status_code)


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """リクエストバリデーション失敗を400へ寄せる。

    FastAPI既定は422だが、本APIでは422をDocling解析エラー専用に割り当てているため
    （docs/spec.md 4章）、入力バリデーションは400 VALIDATION_ERRORへ統一する。
    """
    logger.warning(
        "RequestValidationError",
        extra={"status_code": 400, "detail": str(exc.errors()), "request_id": get_request_id()},
    )
    return error_response(400)


def _domain_error_handler(
    status_code: int, log_message: str
) -> Callable[[Request, Exception], Awaitable[JSONResponse]]:
    """ドメイン例外→構造化エラーのハンドラを生成する（docs/spec.md 4章のステータス対応）。

    例外種別ごとの違いはステータスとログ文言だけなので、ハンドラ本体を型ごとに書き分けない。
    """

    async def handler(request: Request, exc: Exception) -> JSONResponse:
        logger.warning(
            "%s: %s", log_message, exc, extra={"status_code": status_code, "request_id": get_request_id()}
        )
        return error_response(status_code)

    return handler


# app/main.pyがPDFConversionError / AIGenerationErrorに対して登録する。ドメイン例外はmain.py内で
# HTTPExceptionへ変換せず、送出のみ行いここで一元的に整形する（ADR-013）。
pdf_conversion_error_handler = _domain_error_handler(422, "PDF conversion failed")
ai_generation_error_handler = _domain_error_handler(502, "AI generation failed")
