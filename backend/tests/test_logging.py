"""構造化ログ基盤（ADR-011、DEVELOPMENT.md ステップ13）の検証テスト。

- 全レスポンスにX-Request-IDヘッダーが付くこと
- アクセスログが構造化フィールド（request_id/method/path/status_code/duration_ms）付きで出ること
- 未捕捉例外がスタックトレース付きでERRORログに残ること
を実装より先に固定する（TDD）。ログの中身はcaplogが捉えるLogRecordの属性で検証する
（属性はミドルウェアがlogger.info/exceptionのextraで付与する。app/middleware.py参照）。
"""

import json
import logging
import time

import jwt
from fastapi.testclient import TestClient

from app.logging_config import JsonLogFormatter
from app.main import app
from app.services.ai_client import RenderResult, get_ai_client_factory

client = TestClient(app)


def test_response_has_request_id_header():
    response = client.post("/api/render", data={})
    request_id = response.headers.get("X-Request-ID")
    # UUID文字列（36文字・ハイフン区切り）であることを緩く検証する。
    assert request_id is not None
    assert len(request_id) == 36 and request_id.count("-") == 4


def test_access_log_contains_structured_fields(caplog):
    with caplog.at_level(logging.INFO, logger="app.access"):
        response = client.post("/api/render", data={})

    request_id = response.headers["X-Request-ID"]
    access_logs = [r for r in caplog.records if r.name == "app.access" and r.getMessage() == "request completed"]
    assert len(access_logs) == 1

    record = access_logs[0]
    # extra経由で付与された構造化フィールドがLogRecordの属性として載っている。
    assert record.method == "POST"
    assert record.path == "/api/render"
    assert record.status_code == 200
    assert isinstance(record.duration_ms, float)
    # ログの相関IDがレスポンスヘッダーと一致する（画面⇔ログの突き合わせが可能）。
    assert record.request_id == request_id


def test_unhandled_exception_is_logged_with_traceback(caplog):
    class _BrokenAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            raise ValueError("想定外の内部エラー（テスト用）")

    app.dependency_overrides[get_ai_client_factory] = lambda: (lambda engine: _BrokenAIClient())
    try:
        with caplog.at_level(logging.ERROR, logger="app.access"):
            response = client.post("/api/render", data={})
        assert response.status_code == 500

        error_logs = [
            r
            for r in caplog.records
            if r.name == "app.access" and r.levelno == logging.ERROR and r.exc_info is not None
        ]
        assert len(error_logs) == 1
        # 相関IDが付いており、レスポンスヘッダーと一致する。
        assert error_logs[0].request_id == response.headers["X-Request-ID"]
    finally:
        app.dependency_overrides.pop(get_ai_client_factory, None)


def test_json_formatter_outputs_ai_payload_fields():
    # Geminiの入出力全文はフォーマッタの許可リストに載っている場合のみJSONへ出る。
    record = logging.LogRecord(
        name="app.ai",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="Geminiへプロンプトを送信",
        args=(),
        exc_info=None,
    )
    record.ai_model = "gemini-2.5-flash"
    record.ai_prompt = "プロンプト全文"
    record.ai_response = '{"html": "..."}'

    payload = json.loads(JsonLogFormatter().format(record))

    assert payload["ai_model"] == "gemini-2.5-flash"
    assert payload["ai_prompt"] == "プロンプト全文"
    assert payload["ai_response"] == '{"html": "..."}'


def test_json_formatter_outputs_audit_and_diagnostic_fields():
    # user_id（監査証跡）とreason（失敗理由）は許可リスト漏れで欠落していた（ADR-030）。
    record = logging.LogRecord(
        name="app.auth",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="Supabase JWT検証に失敗しました",
        args=(),
        exc_info=None,
    )
    record.user_id = "user-abc"
    record.reason = "Signature verification failed"
    record.engine = "gemini_free"
    record.service = "docling-service"
    record.upstream_status = 422

    payload = json.loads(JsonLogFormatter().format(record))

    assert payload["user_id"] == "user-abc"
    assert payload["reason"] == "Signature verification failed"
    assert payload["engine"] == "gemini_free"
    assert payload["service"] == "docling-service"
    assert payload["upstream_status"] == 422


def test_access_log_records_user_id_for_authenticated_request(monkeypatch, caplog):
    # 監査証跡として「誰の操作か」をアクセスログへ残す（ADR-030）。Supabase側のAuthログは
    # 保持期間がプラン依存のため、アプリ側のログだけで追える状態にしておく。
    # 認証依存はFastAPIによりスレッドプールで実行されうるため、contextvarではなくscopeの
    # stateを経由してミドルウェアへ届く。実トークンを使い、その経路ごと検証する。
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret-for-access-log")
    payload = {"sub": "user-xyz", "aud": "authenticated", "exp": int(time.time()) + 3600}
    token = jwt.encode(payload, "test-secret-for-access-log", algorithm="HS256")

    with caplog.at_level(logging.INFO, logger="app.access"):
        client.post("/api/render", data={}, headers={"Authorization": f"Bearer {token}"})

    access_logs = [
        r for r in caplog.records if r.name == "app.access" and r.getMessage() == "request completed"
    ]
    assert len(access_logs) == 1
    assert access_logs[0].user_id == "user-xyz"


def test_access_log_omits_user_id_for_anonymous_request(caplog):
    with caplog.at_level(logging.INFO, logger="app.access"):
        client.post("/api/render", data={})

    access_logs = [
        r for r in caplog.records if r.name == "app.access" and r.getMessage() == "request completed"
    ]
    assert len(access_logs) == 1
    assert not hasattr(access_logs[0], "user_id")
