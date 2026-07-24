"""リクエスト相関ID採番・アクセスログ・想定外例外の500化を行うASGIミドルウェア（ADR-011/013）。

BaseHTTPMiddlewareではなく素のASGIミドルウェアにしているのは、request_idのcontextvarを
リクエストの最外周で設定し、内側の全処理（ルート・例外ハンドラ）から確実に参照できるようにするため
（BaseHTTPMiddlewareはcontextvarの伝播に既知の制約がある）。
"""

from __future__ import annotations

import logging
import time
import uuid

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import error_response
from app.request_context import reset_request_id, set_request_id

logger = logging.getLogger("app.access")


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # HTTP以外（lifespan/websocket）は相関IDの対象外なので素通しする。
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # 認証依存（app/services/auth.py）はFastAPIによりスレッドプールで実行されうるため、
        # contextvarでは相関できない。同一のscope dictを共有するstate経由でuser_idを受け取る
        # （ADR-030）。Starletteが設定する前に読む可能性を避けるためここで初期化する。
        scope.setdefault("state", {})

        request_id = str(uuid.uuid4())
        token = set_request_id(request_id)
        method = scope.get("method", "-")
        path = scope.get("path", "-")
        start = time.perf_counter()
        # response.startが来る前に例外で終わる場合に備え、既定を500にしておく。
        state = {"status_code": 500}

        async def send_wrapper(message: Message) -> None:
            # 成功/失敗を問わず全レスポンスにX-Request-IDを付け、画面・ログとの相関を可能にする。
            if message["type"] == "http.response.start":
                state["status_code"] = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
            await send(message)

        try:
            try:
                await self.app(scope, receive, send_wrapper)
            except Exception:
                # 登録済み例外ハンドラ（app/errors.py）で捕捉されなかった想定外例外。FastAPIの500
                # ハンドラはこのミドルウェアの外側で動き相関IDを扱えないため、ここで自前に500へ変換する。
                logger.exception(
                    "Unhandled exception during request",
                    extra={"method": method, "path": path, "request_id": request_id},
                )
                response = error_response(500)
                await response(scope, receive, send_wrapper)

            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            fields = {
                "method": method,
                "path": path,
                "status_code": state["status_code"],
                "duration_ms": duration_ms,
                "request_id": request_id,
            }
            user_id = scope["state"].get("user_id")
            if user_id:
                fields["user_id"] = user_id
            logger.info("request completed", extra=fields)
        finally:
            # リクエスト間で相関IDが漏れないよう必ず元へ戻す。
            reset_request_id(token)
