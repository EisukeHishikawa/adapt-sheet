"""リクエスト相関ID採番・アクセスログ・想定外例外の500化を行うASGIミドルウェア（ADR-016/017）。

BaseHTTPMiddlewareではなく素のASGIミドルウェアにしているのは、
- request_idのcontextvarをリクエストの最外周で設定し、内側の全処理（ルート・例外ハンドラ）から
  確実に参照できるようにするため（BaseHTTPMiddlewareはcontextvarの伝播に既知の制約がある）、
- レスポンス送出時にX-Request-IDヘッダーを注入するため、
- 登録済み例外ハンドラで捕捉されなかった想定外例外を、相関IDを保ったまま500エンベロープへ変換するため。
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
    """リクエスト単位の相関ID付与・アクセスログ・想定外例外ハンドリングを担うミドルウェア。"""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        # HTTP以外（lifespan/websocket）は相関IDの対象外なので素通しする。
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = str(uuid.uuid4())
        token = set_request_id(request_id)
        method = scope.get("method", "-")
        path = scope.get("path", "-")
        start = time.perf_counter()
        # response.startが来る前に例外で終わる場合に備え、既定を500にしておく。
        state = {"status_code": 500}

        async def send_wrapper(message: Message) -> None:
            # 全レスポンス（成功/失敗問わず）にX-Request-IDを付け、画面・ログとの相関を可能にする。
            if message["type"] == "http.response.start":
                state["status_code"] = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
            await send(message)

        try:
            try:
                await self.app(scope, receive, send_wrapper)
            except Exception:
                # ここへ来るのは登録済み例外ハンドラ（app/errors.py）で捕捉されなかった想定外例外。
                # 相関IDが有効なうちにスタックトレース付きで記録し、500エンベロープを自前で返す。
                # （FastAPIのException/500ハンドラはこのミドルウェアの外側で動くため相関IDを扱えない）
                logger.exception(
                    "Unhandled exception during request",
                    extra={"method": method, "path": path, "request_id": request_id},
                )
                response = error_response(500)
                await response(scope, receive, send_wrapper)

            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            # アクセスログ: 1リクエスト1行。method/path/status/所要時間を構造化フィールドで残す。
            logger.info(
                "request completed",
                extra={
                    "method": method,
                    "path": path,
                    "status_code": state["status_code"],
                    "duration_ms": duration_ms,
                    "request_id": request_id,
                },
            )
        finally:
            # リクエスト間で相関IDが漏れないよう必ず元へ戻す。
            reset_request_id(token)
