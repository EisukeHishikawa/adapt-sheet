"""RLSコンテキスト設定（app.db.apply_rls_context、ADR-021）のテスト。

実PostgreSQLは起動せず、発行されるSQLと、SQLite（RLS非対応）では何も発行しないことを検証する。
"""

import json

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import apply_rls_context


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
