"""SQLAlchemyモデル定義（DEVELOPMENT.md ステップ28、ADR-019）。

PostgreSQL/SQLite双方でDDLを生成できるよう、方言固有型（postgresql.JSONB等）ではなく
SQLAlchemy 2.0の汎用型（Uuid/JSON）を使う。pytestはSQLiteのin-memory DBでこのメタデータを
そのまま使い、実PostgreSQLを起動せずにテストする。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, DateTime, Float, String, Text, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class RenderHistory(Base):
    """登録ユーザーの生成履歴（docs/spec.md「登録ユーザー」）。描画成功ごとに1行保存する。"""

    __tablename__ = "render_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # SupabaseのJWT `sub`（auth.users.id）。本DBはSupabaseのauth schemaを所有しないため
    # 外部キー制約は張らない（ADR-019）。
    user_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    engine: Mapped[str] = mapped_column(String(32), nullable=False)
    html: Mapped[str] = mapped_column(Text, nullable=False)
    css: Mapped[str] = mapped_column(Text, nullable=False, default="")
    json_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    width_mm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    height_mm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
