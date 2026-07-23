"""add kind to render_history

Revision ID: c3a8f5d21b74
Revises: b1c4d7e90a21
Create Date: 2026-07-23 12:40:00.000000

描画結果に加えて編集中スナップショットも履歴として保存するため、種別列を追加する。
既存行はすべて描画結果のため server_default で "render" を埋める。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3a8f5d21b74'
down_revision: Union[str, None] = 'b1c4d7e90a21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'render_history',
        sa.Column('kind', sa.String(length=16), nullable=False, server_default='render'),
    )


def downgrade() -> None:
    op.drop_column('render_history', 'kind')
