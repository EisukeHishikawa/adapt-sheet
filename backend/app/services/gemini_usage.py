"""Gemini無料枠（gemini_free）の利用回数を、全ユーザー共有の日次カウンタ（JST基準）として記録する。

実際のGemini API無料枠もAPIキー単位の共有リソースであるため、個人単位ではなく1つのカウンタを
日毎にリセットする方式にしている。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import GeminiFreeUsage

GEMINI_FREE_DAILY_LIMIT = 10

_JST = ZoneInfo("Asia/Tokyo")


@dataclass(frozen=True)
class GeminiFreeUsageStatus:
    date: date
    count: int
    limit: int


def _today_jst() -> date:
    return datetime.now(_JST).date()


def record_gemini_free_usage(session: Optional[Session]) -> None:
    """gemini_freeの利用1回分をカウントする。db_session is Noneの場合は何もしない
    （DB未設定のローカル/pytestや、DB接続失敗時と同じ扱い）。"""
    if session is None:
        return

    today = _today_jst()
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        # SQLiteはON CONFLICTの方言差異があるため、PostgreSQLのみUPSERTで1クエリにする。
        session.execute(
            text(
                "INSERT INTO gemini_free_usage (usage_date, count) VALUES (:usage_date, 1) "
                "ON CONFLICT (usage_date) DO UPDATE "
                "SET count = gemini_free_usage.count + 1"
            ),
            {"usage_date": today},
        )
    else:
        row = session.get(GeminiFreeUsage, today)
        if row is None:
            session.add(GeminiFreeUsage(usage_date=today, count=1))
        else:
            row.count += 1
    session.commit()


def get_gemini_free_usage(session: Session) -> GeminiFreeUsageStatus:
    today = _today_jst()
    row = session.get(GeminiFreeUsage, today)
    count = row.count if row is not None else 0
    return GeminiFreeUsageStatus(date=today, count=count, limit=GEMINI_FREE_DAILY_LIMIT)
