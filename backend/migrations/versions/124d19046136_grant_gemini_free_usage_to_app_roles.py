"""grant gemini_free_usage to app roles

Revision ID: 124d19046136
Revises: c364aae167e3
Create Date: 2026-07-28 00:31:14.910318

gemini_free_usageは個人データを持たない全ユーザー共有のカウンタのため、render_historyと違い
RLSは掛けない。未ログイン（authenticatorロールのまま）でもカウント対象のため、
authenticator/authenticated両ロールへ直接GRANTする（app/db.pyのロール切替設計を参照）。
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '124d19046136'
down_revision: Union[str, None] = 'c364aae167e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pytestはSQLite（ロール概念なし）で同じメタデータを使うため、PostgreSQL以外では何もしない。
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("GRANT SELECT, INSERT, UPDATE ON TABLE gemini_free_usage TO authenticator")
    op.execute("GRANT SELECT, INSERT, UPDATE ON TABLE gemini_free_usage TO authenticated")


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("REVOKE SELECT, INSERT, UPDATE ON TABLE gemini_free_usage FROM authenticated")
    op.execute("REVOKE SELECT, INSERT, UPDATE ON TABLE gemini_free_usage FROM authenticator")
