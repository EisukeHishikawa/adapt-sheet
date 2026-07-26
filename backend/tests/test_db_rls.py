"""RLSコンテキスト設定（app.db.apply_rls_context）のテスト。

実PostgreSQLは起動せず、発行されるSQLと、SQLite（RLS非対応）では何も発行しないことを検証する。
"""

import json
import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import app.db as db_module
from app.db import apply_rls_context, get_db_session_or_none


class _FakeDialect:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeBind:
    def __init__(self, dialect_name: str) -> None:
        self.dialect = _FakeDialect(dialect_name)


class _RecordingSession:
    """executeへ渡されたSQLと引数だけを記録する最小のスタブ。"""

    def __init__(self, dialect_name: str) -> None:
        self.bind = _FakeBind(dialect_name)
        self.statements: list[tuple[str, dict]] = []

    def execute(self, statement, params=None):
        self.statements.append((str(statement), params or {}))


def test_sets_jwt_claims_and_switches_role_on_postgresql():
    session = _RecordingSession("postgresql")

    apply_rls_context(session, "11111111-2222-3333-4444-555555555555")

    sql_texts = [sql for sql, _ in session.statements]
    assert "set_config('request.jwt.claims'" in sql_texts[0]
    # auth.uid()はrequest.jwt.claimsのsubを読むため、subを含むJSONで渡す必要がある。
    assert json.loads(session.statements[0][1]["claims"]) == {
        "sub": "11111111-2222-3333-4444-555555555555"
    }
    # ロール切り替えはクレーム設定の後（切り替え前に値を入れておく）。
    assert sql_texts[1] == "SET LOCAL ROLE authenticated"


def test_does_nothing_on_sqlite():
    """pytestはSQLiteで走るため、RLS用のSQLを発行してはならない（発行すると全テストが壊れる）。"""
    session = _RecordingSession("sqlite")

    apply_rls_context(session, "user-1")

    assert session.statements == []


def test_does_nothing_when_session_has_no_bind():
    session = _RecordingSession("postgresql")
    session.bind = None

    apply_rls_context(session, "user-1")

    assert session.statements == []


def test_real_sqlite_session_is_unaffected():
    """スタブではなく実Sessionでも、SQLite接続なら例外なくスキップされる。"""
    engine = create_engine("sqlite://")
    with Session(engine) as session:
        apply_rls_context(session, "user-1")


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
