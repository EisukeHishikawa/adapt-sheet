"""SQLAlchemyのエンジン・セッション管理（DEVELOPMENT.md ステップ28、ADR-019/021）。

エンジンはコネクションプールを持つため、他のget_*ファクトリ（app/services/*.py）と異なり
リクエストごとに作り直さず、モジュールスコープで1つだけ生成してキャッシュする（Sessionのみ
リクエストごとに新規発行する）。

接続先はSupabaseのPostgresで、render_historyにはRLSが有効化されている（ADR-021）。アプリは
RLSを迂回しない`authenticator`ロールで接続し、リクエストごとにログイン中ユーザーのJWT `sub`を
トランザクションローカルなGUCへ設定してから`authenticated`ロールへ切り替える（PostgRESTと同じ
方式）。これによりWHERE句の書き忘れやSQLインジェクションがあっても他人の行へ到達できない。
"""

from __future__ import annotations

import json
import logging
import os
from typing import Callable, Iterator, Optional

from fastapi import Depends
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.services.auth import SupabaseUser, get_current_user

logger = logging.getLogger("app.db")

_engine: Optional[Engine] = None
_session_factory: Optional[sessionmaker] = None


def _get_session_factory() -> sessionmaker:
    global _engine, _session_factory
    if _session_factory is None:
        url = os.getenv("DATABASE_URL", "").strip()
        if not url:
            raise RuntimeError("DATABASE_URL is not set")
        _engine = create_engine(url, pool_pre_ping=True)
        _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _session_factory


def apply_rls_context(session: Session, user_id: str) -> None:
    """RLSポリシーが参照するユーザーIDを、このトランザクションに限って設定する。

    pytestはSQLite（RLS非対応）で走るため、PostgreSQL以外では何もしない。SET LOCALは
    プレースホルダを取れないため、値を渡す側はset_config(..., is_local=true)を使う。
    """
    if session.bind is None or session.bind.dialect.name != "postgresql":
        return
    # auth.uid()はrequest.jwt.claimsのsubを読む（Supabaseの標準関数）。
    session.execute(
        text("SELECT set_config('request.jwt.claims', :claims, true)"),
        {"claims": json.dumps({"sub": user_id})},
    )
    # 切り替え後はRLSの対象になる。ロール名は固定値のためリテラルで埋める。
    session.execute(text("SET LOCAL ROLE authenticated"))


def ping_database() -> bool:
    """SupabaseのPostgresへ最小のクエリを投げる（ADR-028）。

    無料プランのSupabaseプロジェクトは一定期間アクセスが無いと一時停止されるため、
    フロントを開くたびにここを通して「使われている」状態を保つ。DATABASE_URL未設定の
    ローカル/pytestではFalseを返すだけで何もしない。
    """
    if not os.getenv("DATABASE_URL", "").strip():
        return False

    try:
        session = _get_session_factory()()
    except Exception:
        logger.warning("DBキープアライブの接続準備に失敗しました", exc_info=True)
        return False

    try:
        session.execute(text("SELECT 1"))
        return True
    except Exception:
        # キープアライブの失敗は画面の機能に影響しないため、ログのみに留める。
        logger.warning("DBキープアライブのクエリに失敗しました", exc_info=True)
        return False
    finally:
        session.close()


def get_db_pinger() -> Callable[[], bool]:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return ping_database


def get_db_session(
    current_user: Optional[SupabaseUser] = Depends(get_current_user),
) -> Iterator[Session]:
    """FastAPIのDependsとして利用する。テスト側はdependency_overridesで差し替える。

    DATABASE_URL未設定時はRuntimeErrorを送出する（GET /api/historyのようにDBが必須の
    エンドポイント向け）。DB保存が失敗しても本体機能（/api/render）を止めたくない箇所は
    get_db_session_or_noneを使う。
    """
    session = _get_session_factory()()
    try:
        if current_user is not None:
            apply_rls_context(session, current_user.sub)
        yield session
    finally:
        session.close()


def get_db_session_or_none(
    current_user: Optional[SupabaseUser] = Depends(get_current_user),
) -> Iterator[Optional[Session]]:
    """DATABASE_URL未設定（ローカル/pytestの既定）ではNoneを返し、呼び出し側にDB保存を
    スキップさせる（app/main.pyの/api/render、履歴の自動保存）。
    """
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        yield None
        return

    session = _get_session_factory()()
    try:
        if current_user is not None:
            apply_rls_context(session, current_user.sub)
        yield session
    finally:
        session.close()
