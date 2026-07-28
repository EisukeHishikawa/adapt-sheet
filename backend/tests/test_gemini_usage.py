"""Gemini無料枠（gemini_free）の日次利用カウンタのテスト。

実PostgreSQLは使わず、SQLiteのin-memory DBにapp.models.Baseのメタデータをそのまま使う
（他のtest_history.py等と同じ方式）。
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base
from app.services.gemini_usage import (
    GEMINI_FREE_DAILY_LIMIT,
    get_gemini_free_usage,
    record_gemini_free_usage,
)


def _sqlite_session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    return factory()


def test_get_gemini_free_usage_returns_zero_when_no_rows() -> None:
    db_session = _sqlite_session()

    status = get_gemini_free_usage(db_session)

    assert status.count == 0
    assert status.limit == GEMINI_FREE_DAILY_LIMIT
    assert status.date == date.today() or isinstance(status.date, date)


def test_record_gemini_free_usage_increments_count() -> None:
    db_session = _sqlite_session()

    record_gemini_free_usage(db_session)
    record_gemini_free_usage(db_session)
    status = get_gemini_free_usage(db_session)

    assert status.count == 2


def test_record_gemini_free_usage_noop_when_session_is_none() -> None:
    # DB未設定（DATABASE_URL未設定）のローカル/pytestではNoneが渡され、何もしない。
    record_gemini_free_usage(None)
