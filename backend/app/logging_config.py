"""構造化ログ（1レコード=1行のJSON）の設定（ADR-011）。

コンテナ・AWS Lambdaは標準出力のログを収集する運用のため、追加依存（structlog等）を入れず
標準の`logging`のみで、標準出力へ1行1レコードのJSONを出す。
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

from app.request_context import get_request_id


class JsonLogFormatter(logging.Formatter):
    """LogRecordをJSON1行へ整形する。"""

    # extra経由でレコードに載りうる文脈フィールド。ここに列挙したものだけを出力し、
    # loggingが内部で付与する標準属性（args, pathname等）は出さない。
    _CONTEXT_FIELDS = (
        "request_id",
        "method",
        "path",
        "status_code",
        "duration_ms",
        "detail",
        # AI生成の入出力全文。app/services/ai_client.pyがLOG_AI_PAYLOAD有効時のみ付与する。
        "ai_model",
        "ai_prompt",
        "ai_response",
    )

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            # ログ集約側でのソート・検索性のためISO8601(UTC)の文字列にする。
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        for field in self._CONTEXT_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value

        # ミドルウェア以外のロガーからのログにも相関IDを付けられるよう、contextvarから補完する。
        if "request_id" not in payload:
            request_id = get_request_id()
            if request_id:
                payload["request_id"] = request_id

        # 1行JSONを維持するため、スタックトレースは文字列化して1フィールドにまとめる。
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        # ensure_ascii=Falseで日本語ログをそのまま読めるようにし、default=strで非JSON型が
        # 混ざってもログ出力自体は落とさない。
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    """ルートロガーにJSONフォーマッタのハンドラを1つだけ設定する。

    アプリ起動時（app/main.pyのインポート時）に一度だけ呼ぶ。uvicornが独自に設定するハンドラと
    二重に出さないよう、既存ハンドラをクリアしてルートロガーへ集約する。
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter())

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(level)
