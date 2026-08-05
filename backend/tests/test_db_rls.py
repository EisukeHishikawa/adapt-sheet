"""RLSコンテキスト設定（app.db.apply_rls_context）のテスト。

実PostgreSQLは起動せず、発行されるSQLと、SQLite（RLS非対応）では何も発行しないことを検証する。
"""

import json
import time

import pytest
from sqlalchemy import create_engine, text as sa_text
from sqlalchemy.orm import Session

import app.db as db_module
from app.db import apply_rls_context, get_db_session_or_none


class _RecordingConnection:
    """executeへ渡されたSQLと引数だけを記録する最小のスタブ。"""

    def __init__(self) -> None:
        self.statements: list[tuple[str, dict]] = []

    def execute(self, statement, params=None):
        self.statements.append((str(statement), params or {}))


def _sqlite_session_pretending_to_be_postgresql(monkeypatch) -> Session:
    """SQLite上で、PostgreSQL向けの分岐だけを通すセッション。

    実際のRLS用SQL（_set_rls_context）はSQLiteで実行できないため、呼び出し側は
    必ずそちらを差し替えて使う。
    """
    engine = create_engine("sqlite://")
    monkeypatch.setattr(engine.dialect, "name", "postgresql")
    return Session(engine)


def test_sets_jwt_claims_and_switches_role_on_postgresql():
    connection = _RecordingConnection()

    db_module._set_rls_context(
        connection, json.dumps({"sub": "11111111-2222-3333-4444-555555555555"})
    )

    sql_texts = [sql for sql, _ in connection.statements]
    assert "set_config('request.jwt.claims'" in sql_texts[0]
    # auth.uid()はrequest.jwt.claimsのsubを読むため、subを含むJSONで渡す必要がある。
    assert json.loads(connection.statements[0][1]["claims"]) == {
        "sub": "11111111-2222-3333-4444-555555555555"
    }
    # ロール切り替えはクレーム設定の後（切り替え前に値を入れておく）。
    assert sql_texts[1] == "SET LOCAL ROLE authenticated"


def test_reapplies_context_on_every_transaction(monkeypatch):
    """commitでSET LOCALが失われるため、トランザクション開始のたびに再設定する。

    1度きりの設定だと、commit後に同じセッションで走る処理（save_historyのrefresh等）が
    authenticatorロールのままRLS対象テーブルへ触れてしまい権限エラーになる。
    """
    applied: list[str] = []
    monkeypatch.setattr(
        db_module, "_set_rls_context", lambda _connection, claims: applied.append(claims)
    )

    with _sqlite_session_pretending_to_be_postgresql(monkeypatch) as session:
        apply_rls_context(session, "user-1")

        session.execute(sa_text("SELECT 1"))
        session.commit()
        session.execute(sa_text("SELECT 1"))
        session.commit()

    assert applied == [json.dumps({"sub": "user-1"})] * 2


def test_applies_context_immediately_when_transaction_already_open(monkeypatch):
    applied: list[str] = []
    monkeypatch.setattr(
        db_module, "_set_rls_context", lambda _connection, claims: applied.append(claims)
    )

    with _sqlite_session_pretending_to_be_postgresql(monkeypatch) as session:
        session.execute(sa_text("SELECT 1"))

        apply_rls_context(session, "user-1")

    assert applied == [json.dumps({"sub": "user-1"})]


def test_does_nothing_on_sqlite(monkeypatch):
    """pytestはSQLiteで走るため、RLS用のSQLを発行してはならない（発行すると全テストが壊れる）。"""
    applied: list[str] = []
    monkeypatch.setattr(
        db_module, "_set_rls_context", lambda _connection, claims: applied.append(claims)
    )

    with Session(create_engine("sqlite://")) as session:
        apply_rls_context(session, "user-1")
        session.execute(sa_text("SELECT 1"))

    assert applied == []


def test_does_nothing_when_session_has_no_bind(monkeypatch):
    applied: list[str] = []
    monkeypatch.setattr(
        db_module, "_set_rls_context", lambda _connection, claims: applied.append(claims)
    )

    class _BindlessSession:
        bind = None

    apply_rls_context(_BindlessSession(), "user-1")

    assert applied == []


def test_close_session_calls_close_on_the_underlying_session():
    class _RecordingCloseSession:
        def __init__(self) -> None:
            self.closed = False

        def close(self) -> None:
            self.closed = True

    session = _RecordingCloseSession()
    db_module._close_session(session)

    assert session.closed is True


def test_close_session_gives_up_after_timeout_instead_of_blocking(monkeypatch):
    """session.close()がコネクションプーラー側の事情でハングしても、
    呼び出し元（/api/renderのリクエスト処理）を巻き込んでブロックし続けない。
    """
    monkeypatch.setattr(db_module, "_DB_CLOSE_TIMEOUT_SECONDS", 0.2)

    class _HangingCloseSession:
        def close(self) -> None:
            time.sleep(5)

    start = time.monotonic()
    db_module._close_session(_HangingCloseSession())
    elapsed = time.monotonic() - start

    assert elapsed < 2.0


def test_get_db_session_or_none_yields_none_when_connection_fails(monkeypatch):
    """DATABASE_URLは設定済みだが接続自体に失敗する場合、例外を送出せずNoneを返す。

    /api/renderはこの関数の戻り値がNoneなら履歴保存をスキップするだけで、本体の
    PDF描画は継続する（DB障害で描画自体が落ちてはならない）。
    """
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://unreachable-host/db")

    def _raise_session_factory():
        raise RuntimeError("could not connect")

    monkeypatch.setattr(db_module, "_get_session_factory", _raise_session_factory)

    gen = get_db_session_or_none(current_user=None)
    assert next(gen) is None
    with pytest.raises(StopIteration):
        next(gen)
