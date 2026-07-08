"""構造化ログ（1レコード=1行のJSON）の設定（ADR-016、DEVELOPMENT.md ステップ13）。

structlog等の追加依存を入れず、Python標準の`logging`のみでJSON構造化ログを実現する。
コンテナ（ADR-012/014）やAWS Lambda（フェーズ4）は標準出力のログを収集する運用のため、
標準出力へ1行1レコードのJSONを出す方式が最も相性が良い。
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

from app.request_context import get_request_id


class JsonLogFormatter(logging.Formatter):
    """LogRecordをJSON1行へ整形するフォーマッタ。

    アクセスログ・エラーログで`extra={...}`により付与される文脈フィールド
    （method/path/status_code/duration_ms/detail等）を拾い上げてトップレベルに展開する。
    request_idはミドルウェアがextraで明示的に渡すが、それ以外のロガーからのログにも
    相関IDを付けられるよう、extraに無ければcontextvarからフォールバックで補完する。
    """

    # extra経由でレコードに載る可能性のある文脈フィールド。ここに列挙したものだけを
    # JSONへ出力し、loggingが内部で付与する多数の標準属性（args, pathname等）は出さない。
    _CONTEXT_FIELDS = ("request_id", "method", "path", "status_code", "duration_ms", "detail")

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

        # 明示的にrequest_idが渡されていないログにも、可能なら相関IDを補完する。
        if "request_id" not in payload:
            request_id = get_request_id()
            if request_id:
                payload["request_id"] = request_id

        # 例外情報はスタックトレースを文字列化して1フィールドにまとめる（1行JSONを維持）。
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        # ensure_ascii=Falseで日本語ログをそのまま読めるようにし、
        # default=strでdatetime等の非JSON型が混ざっても落とさない。
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    """ルートロガーにJSONフォーマッタのハンドラを1つだけ設定する。

    アプリ起動時（app/main.pyのインポート時）に一度だけ呼ぶ。多重登録による
    ログ重複を避けるため既存ハンドラをクリアしてから設定する。uvicornが独自に
    設定するハンドラと二重に出さないよう、ルートロガーに集約する方針とした。
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter())

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(level)
