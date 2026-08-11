"""enable RLS on gemini_free_usage

Revision ID: f2b6d904ae31
Revises: 124d19046136
Create Date: 2026-08-05 10:00:00.000000

gemini_free_usageはpublicスキーマにあるため、SupabaseのData API（PostgREST）から
`anon`／`authenticated`ロールで直接読み書きできてしまう。アプリはこのテーブルを
ロール切り替え前の`authenticator`のまま操作する（PostgRESTが決して使わないロール）ため、
権限とポリシーを`authenticator`だけに絞り、Data API経由の到達をDB側で塞ぐ。
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "f2b6d904ae31"
down_revision: Union[str, None] = "124d19046136"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pytestはSQLite（RLS・ロール非対応）で同じメタデータを使うため、PostgreSQL以外では何もしない。
    if op.get_bind().dialect.name != "postgresql":
        return

    # Supabaseがpublicスキーマの新規テーブルへ自動付与する権限も含めて落とす。
    op.execute("REVOKE ALL ON TABLE gemini_free_usage FROM anon")
    op.execute("REVOKE ALL ON TABLE gemini_free_usage FROM authenticated")

    op.execute("ALTER TABLE gemini_free_usage ENABLE ROW LEVEL SECURITY")
    # テーブル所有者にもポリシーを適用する（render_historyと同じ扱い）。
    op.execute("ALTER TABLE gemini_free_usage FORCE ROW LEVEL SECURITY")

    # 全ユーザー共有の日次カウンタで所有者の概念が無いため、行の絞り込み条件は持たせない。
    # 「誰が触れるか」を権限とロールだけで決めるのがこのテーブルの防御になる。
    op.execute(
        """
        CREATE POLICY gemini_free_usage_app_select ON gemini_free_usage
            FOR SELECT TO authenticator
            USING (true)
        """
    )
    op.execute(
        """
        CREATE POLICY gemini_free_usage_app_insert ON gemini_free_usage
            FOR INSERT TO authenticator
            WITH CHECK (true)
        """
    )
    op.execute(
        """
        CREATE POLICY gemini_free_usage_app_update ON gemini_free_usage
            FOR UPDATE TO authenticator
            USING (true)
            WITH CHECK (true)
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("DROP POLICY IF EXISTS gemini_free_usage_app_update ON gemini_free_usage")
    op.execute("DROP POLICY IF EXISTS gemini_free_usage_app_insert ON gemini_free_usage")
    op.execute("DROP POLICY IF EXISTS gemini_free_usage_app_select ON gemini_free_usage")
    op.execute("ALTER TABLE gemini_free_usage NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE gemini_free_usage DISABLE ROW LEVEL SECURITY")
    op.execute("GRANT SELECT, INSERT, UPDATE ON TABLE gemini_free_usage TO authenticated")
