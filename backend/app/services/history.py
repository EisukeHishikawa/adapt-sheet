"""生成履歴の保存・一覧取得（DEVELOPMENT.md ステップ28、ADR-019）。"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RenderHistory

# GET /api/historyが返す件数の上限。フロントのHistorySlider（クライアント側・最大10件）とは
# 別物で、DB側の一覧取得も際限なく返さないよう上限を設ける。
MAX_HISTORY_ITEMS = 50


def save_history(
    session: Session,
    *,
    user_id: str,
    engine: str,
    html: str,
    css: str,
    json_data: dict,
    width_mm: Optional[float],
    height_mm: Optional[float],
    kind: str = "render",
) -> RenderHistory:
    entry = RenderHistory(
        user_id=user_id,
        engine=engine,
        html=html,
        css=css,
        json_data=json_data,
        width_mm=width_mm,
        height_mm=height_mm,
        kind=kind,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def list_history(session: Session, *, user_id: str) -> list[RenderHistory]:
    stmt = (
        select(RenderHistory)
        .where(RenderHistory.user_id == user_id)
        .order_by(RenderHistory.created_at.desc())
        .limit(MAX_HISTORY_ITEMS)
    )
    return list(session.scalars(stmt))
