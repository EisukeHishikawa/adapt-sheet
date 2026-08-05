"""SQLAlchemyモデル定義。

PostgreSQL/SQLite双方でDDLを生成できるよう、方言固有型（postgresql.JSONB等）ではなく
SQLAlchemy 2.0の汎用型（Uuid/JSON）を使う。pytestはSQLiteのin-memory DBでこのメタデータを
そのまま使い、実PostgreSQLを起動せずにテストする。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Date, DateTime, Float, Integer, String, Text, Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class RenderHistory(Base):
    """登録ユーザーの生成履歴（docs/spec.md「登録ユーザー」）。描画成功ごとに1行保存する。"""

    __tablename__ = "render_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # SupabaseのJWT `sub`（auth.users.id）。本DBはSupabaseのauth schemaを所有しないため
    # 外部キー制約は張らない。
    user_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    engine: Mapped[str] = mapped_column(String(32), nullable=False)
    # "render"（描画結果）か "edit"（描画前の編集中スナップショット）か。編集中も履歴として
    # 残すため、一覧で両者を区別できる種別を持つ。既存行は "render" とみなす。
    kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default="render", server_default="render"
    )
    html: Mapped[str] = mapped_column(Text, nullable=False)
    css: Mapped[str] = mapped_column(Text, nullable=False, default="")
    json_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    width_mm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    height_mm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )


class GeminiFreeUsage(Base):
    """Gemini無料枠（gemini_free）の利用回数。全ユーザー共有の日次カウンタ（JST基準）。

    未ログインでもカウント対象で行の所有者が無いため、RLSは行を絞るのではなく
    `authenticator`ロールにだけ権限とポリシーを与える形で掛ける（SupabaseのData API経由で
    触れないようにするため）。"""

    __tablename__ = "gemini_free_usage"

    usage_date: Mapped[date] = mapped_column(Date, primary_key=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
