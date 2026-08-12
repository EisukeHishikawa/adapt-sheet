"""生成履歴の保存・一覧取得。"""

from __future__ import annotations

import json
import uuid
from typing import Optional

from sqlalchemy import Text, cast, or_, select
from sqlalchemy.orm import Session

from app.models import RenderHistory

# 1リクエストで返す上限。フロントの表示件数とは別物。
MAX_HISTORY_ITEMS = 50
# limit未指定時の1ページ分。html/cssを含む重い行を一度に返しすぎないため小さく取る。
DEFAULT_HISTORY_PAGE_SIZE = 20


def _like_pattern(value: str) -> str:
    """部分一致用のLIKEパターン。ユーザー入力の%・_を文字として扱うためエスケープする。"""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


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


def update_edit_history(
    session: Session,
    *,
    entry_id: str,
    user_id: str,
    engine: str,
    html: str,
    css: str,
    json_data: dict,
    width_mm: Optional[float],
    height_mm: Optional[float],
) -> Optional[RenderHistory]:
    """編集中スナップショットを上書きする。編集を続けても行を増やさないため。

    自分の編集中の行が見つからない場合はNoneを返す（他ユーザーの行・存在しないID・
    UUIDとして解釈できないIDを含む）。
    """
    try:
        target_id = uuid.UUID(entry_id)
    except ValueError:
        return None

    stmt = select(RenderHistory).where(
        RenderHistory.id == target_id,
        RenderHistory.user_id == user_id,
        RenderHistory.kind == "edit",
    )
    entry = session.scalars(stmt).first()
    if entry is None:
        return None

    entry.engine = engine
    entry.html = html
    entry.css = css
    entry.json_data = json_data
    entry.width_mm = width_mm
    entry.height_mm = height_mm
    session.commit()
    session.refresh(entry)
    return entry


def list_history(
    session: Session,
    *,
    user_id: str,
    query: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = DEFAULT_HISTORY_PAGE_SIZE,
    offset: int = 0,
) -> list[RenderHistory]:
    """新しい順に1ページ分だけ返す。履歴が増えても全件を読まないため。"""
    stmt = select(RenderHistory).where(RenderHistory.user_id == user_id)
    if kind:
        stmt = stmt.where(RenderHistory.kind == kind)
    if query and query.strip():
        keyword = query.strip()
        json_text = cast(RenderHistory.json_data, Text)
        # 業務データ（json_data）側の値も探せるよう、HTMLとJSONの両方を対象にする。
        # JSONは非ASCII文字を\uXXXXへエスケープした形で保存されるため、その形も併せて照合する。
        stmt = stmt.where(
            or_(
                RenderHistory.html.ilike(_like_pattern(keyword), escape="\\"),
                json_text.ilike(_like_pattern(keyword), escape="\\"),
                json_text.ilike(_like_pattern(json.dumps(keyword)[1:-1]), escape="\\"),
            )
        )
    return list(
        session.scalars(
            stmt.order_by(RenderHistory.created_at.desc())
            .limit(max(1, min(limit, MAX_HISTORY_ITEMS)))
            .offset(max(0, offset))
        )
    )


def delete_history(session: Session, *, entry_id: str, user_id: str) -> bool:
    """自分の履歴1件を削除する。他ユーザーの行・存在しないID・不正なIDではFalseを返す。"""
    try:
        target_id = uuid.UUID(entry_id)
    except ValueError:
        return False

    stmt = select(RenderHistory).where(RenderHistory.id == target_id, RenderHistory.user_id == user_id)
    entry = session.scalars(stmt).first()
    if entry is None:
        return False

    session.delete(entry)
    session.commit()
    return True
