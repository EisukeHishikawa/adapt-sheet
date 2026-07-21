"""enable RLS on render_history

Revision ID: b1c4d7e90a21
Revises: 9efb14568497
Create Date: 2026-07-21 13:20:00.000000

生成履歴をSupabaseのPostgresへ置き、行レベルセキュリティで「自分の行しか読み書きできない」
状態をDB側で保証する（ADR-021）。アプリはauthenticatorロールで接続し、リクエストごとに
authenticatedロールへ切り替えるため、そのロールにだけ権限とポリシーを与える。
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b1c4d7e90a21'
down_revision: Union[str, None] = '9efb14568497'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pytestはSQLite（RLS非対応）で同じメタデータを使うため、PostgreSQL以外では何もしない。
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE render_history TO authenticated")
    op.execute("ALTER TABLE render_history ENABLE ROW LEVEL SECURITY")
    # テーブル所有者（マイグレーションを流すpostgresロール）にもポリシーを適用する。
    op.execute("ALTER TABLE render_history FORCE ROW LEVEL SECURITY")
    # user_idはauth.usersのidをJWTのsubからそのまま保持したTEXT。auth.uid()はuuidを返すため
    # textへ寄せて比較する（型を揃えるためのキャストであり、比較対象は同じ値）。
    op.execute(
        """
        CREATE POLICY render_history_owner_select ON render_history
            FOR SELECT TO authenticated
            USING (user_id = auth.uid()::text)
        """
    )
    op.execute(
        """
        CREATE POLICY render_history_owner_insert ON render_history
            FOR INSERT TO authenticated
            WITH CHECK (user_id = auth.uid()::text)
        """
    )
    op.execute(
        """
        CREATE POLICY render_history_owner_delete ON render_history
            FOR DELETE TO authenticated
            USING (user_id = auth.uid()::text)
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("DROP POLICY IF EXISTS render_history_owner_delete ON render_history")
    op.execute("DROP POLICY IF EXISTS render_history_owner_insert ON render_history")
    op.execute("DROP POLICY IF EXISTS render_history_owner_select ON render_history")
    op.execute("ALTER TABLE render_history NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE render_history DISABLE ROW LEVEL SECURITY")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE render_history FROM authenticated")
