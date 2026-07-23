"""allow owner update on render_history

Revision ID: d5b2e7c48f10
Revises: c3a8f5d21b74
Create Date: 2026-07-23 13:10:00.000000

編集中スナップショットは編集のたびに行を増やさず同じ行を上書きするため（ADR-025）、
自分の行に対するUPDATEを許可するポリシーを追加する。
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd5b2e7c48f10'
down_revision: Union[str, None] = 'c3a8f5d21b74'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pytestはSQLite（RLS非対応）で同じメタデータを使うため、PostgreSQL以外では何もしない。
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute(
        """
        CREATE POLICY render_history_owner_update ON render_history
            FOR UPDATE TO authenticated
            USING (user_id = auth.uid()::text)
            WITH CHECK (user_id = auth.uid()::text)
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("DROP POLICY IF EXISTS render_history_owner_update ON render_history")
