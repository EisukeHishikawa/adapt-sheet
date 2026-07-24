"""内部サービスの構造化ログと相関ID引き継ぎ（app/logging_config.py、ADR-030）の検証。

app.mainではなく最小のFastAPIアプリへミドルウェアを載せて検証する。変換エンジン本体
（Docling/pdf2htmlEX）の重い依存を引かずに、ログの契約だけを固定できるため。
app.mainへの組み込み自体はtest_main.pyのHTTP契約テストが通ることで担保される。
"""

import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.logging_config import JsonLogFormatter, RequestContextMiddleware


def _client() -> TestClient:
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    @app.get("/ping")
    def ping() -> dict:
        return {"status": "ok"}

    return TestClient(app)


def test_inbound_request_id_is_reused_in_access_log(caplog):
    # backendが採番したIDをそのまま使うことで、1つのrequest_idで両サービスのログを追える。
    with caplog.at_level(logging.INFO, logger="app.access"):
        response = _client().get("/ping", headers={"X-Request-ID": "abc-123"})

    assert response.headers["X-Request-ID"] == "abc-123"
    records = [r for r in caplog.records if r.name == "app.access"]
    assert len(records) == 1
    assert records[0].request_id == "abc-123"
    assert records[0].path == "/ping"
    assert records[0].status_code == 200


def test_request_id_is_generated_when_header_absent(caplog):
    with caplog.at_level(logging.INFO, logger="app.access"):
        response = _client().get("/ping")

    request_id = response.headers["X-Request-ID"]
    assert len(request_id) == 36 and request_id.count("-") == 4
    records = [r for r in caplog.records if r.name == "app.access"]
    assert records[0].request_id == request_id


def test_malformed_request_id_header_is_rejected(caplog):
    # ログインジェクション（改行・制御文字の混入）を避けるため、印字可能な値以外は採用しない。
    with caplog.at_level(logging.INFO, logger="app.access"):
        response = _client().get("/ping", headers={"X-Request-ID": "abc\tdef"})

    assert response.headers["X-Request-ID"] != "abc\tdef"


def test_formatter_emits_single_line_json():
    # CloudWatch Logsが1レコードとして扱えるよう、必ず1行のJSONにする。
    record = logging.LogRecord(
        name="app.access",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="request completed",
        args=(),
        exc_info=None,
    )
    record.request_id = "abc-123"
    record.status_code = 200

    line = JsonLogFormatter().format(record)

    assert "\n" not in line
    import json

    payload = json.loads(line)
    assert payload["request_id"] == "abc-123"
    assert payload["status_code"] == 200
    assert payload["level"] == "INFO"
