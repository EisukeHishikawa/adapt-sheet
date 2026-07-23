"""内部サービスの構造化ログ（1レコード=1行のJSON）と相関ID引き継ぎ（ADR-011/030）。

backendと同形式のJSONを標準出力へ出し、backendが`X-Request-ID`で渡してきた相関IDを
そのまま使うことで、CloudWatch Logs Insightsで1つのrequest_idからbackend側とこちら側の
ログを横断的に追える。

backend/app/logging_config.py とは意図的に別実装（各サービスは独立したイメージで、
共有パッケージを持たない）。フィールド名は突き合わせのため揃える。
"""

from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from datetime import datetime, timezone

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

REQUEST_ID_HEADER = "X-Request-ID"

_CONTEXT_FIELDS = (
    "request_id",
    "method",
    "path",
    "status_code",
    "duration_ms",
    "reason",
)


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for field in _CONTEXT_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter())

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(level)


class RequestContextMiddleware:
    """backendから渡された相関IDでアクセスログを出す素のASGIミドルウェア。

    PDFバイト列・ファイル名は業務データを含みうるためログに出さない（ADR-011）。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._logger = logging.getLogger("app.access")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _inbound_request_id(scope) or str(uuid.uuid4())
        start = time.perf_counter()
        state = {"status_code": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                state["status_code"] = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        await self.app(scope, receive, send_wrapper)

        self._logger.info(
            "request completed",
            extra={
                "request_id": request_id,
                "method": scope.get("method", "-"),
                "path": scope.get("path", "-"),
                "status_code": state["status_code"],
                "duration_ms": round((time.perf_counter() - start) * 1000, 2),
            },
        )


def _inbound_request_id(scope: Scope) -> str:
    target = REQUEST_ID_HEADER.lower().encode()
    for name, value in scope.get("headers", []):
        if name.lower() == target:
            # ログインジェクション（改行・巨大な値）を避けるため、長さと文字種を絞る。
            candidate = value.decode("latin-1", "replace").strip()[:64]
            if candidate.isprintable():
                return candidate
    return ""
