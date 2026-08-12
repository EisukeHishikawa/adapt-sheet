"""enable RLS on alembic_version

Revision ID: 135b9872a987
Revises: f2b6d904ae31
Create Date: 2026-08-12 00:00:00.000000

alembic_versionはAlembicが自動作成するpublicスキーマのテーブルで、他の管理対象テーブル
（render_history/gemini_free_usage）と違い専用の作成マイグレーションを持たないため、RLSが
未設定のまま残っていた（Supabase Security Advisorのrls_disabled_in_public指摘）。
アプリはこのテーブルを実行時に一切参照せず、マイグレーションはRLSをバイパスする所有者ロール
（MIGRATION_DATABASE_URL）で走るため、anon/authenticatedへの到達を塞ぐだけでよい。
"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "135b9872a987"
down_revision: Union[str, None] = "f2b6d904ae31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pytestはSQLite（RLS非対応）で同じメタデータを使うため、PostgreSQL以外では何もしない。
    if op.get_bind().dialect.name != "postgresql":
        return

    # Supabaseがpublicスキーマの新規テーブルへ自動付与する権限も含めて落とす。
    op.execute("REVOKE ALL ON TABLE alembic_version FROM anon")
    op.execute("REVOKE ALL ON TABLE alembic_version FROM authenticated")

    op.execute("ALTER TABLE alembic_version ENABLE ROW LEVEL SECURITY")
    # マイグレーションを流す所有者ロールにもポリシーを適用する（他テーブルと同じ扱い）。
    op.execute("ALTER TABLE alembic_version FORCE ROW LEVEL SECURITY")
    # 到達させたいアプリ側のロールが無いため、ポリシーは追加しない（所有者ロールのみ到達可能）。


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    op.execute("ALTER TABLE alembic_version NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE alembic_version DISABLE ROW LEVEL SECURITY")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE alembic_version TO anon")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE alembic_version TO authenticated")
