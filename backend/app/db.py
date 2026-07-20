"""SQLAlchemyのエンジン・セッション管理（DEVELOPMENT.md ステップ28、ADR-019）。

エンジンはコネクションプールを持つため、他のget_*ファクトリ（app/services/*.py）と異なり
リクエストごとに作り直さず、モジュールスコープで1つだけ生成してキャッシュする（Sessionのみ
リクエストごとに新規発行する）。
"""

from __future__ import annotations

import os
from typing import Iterator, Optional

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

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


def get_db_session() -> Iterator[Session]:
    """FastAPIのDependsとして利用する。テスト側はdependency_overridesで差し替える。

    DATABASE_URL未設定時はRuntimeErrorを送出する（GET /api/historyのようにDBが必須の
    エンドポイント向け）。DB保存が失敗しても本体機能（/api/render）を止めたくない箇所は
    get_db_session_or_noneを使う。
    """
    session = _get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def get_db_session_or_none() -> Iterator[Optional[Session]]:
    """DATABASE_URL未設定（ローカル/pytestの既定）ではNoneを返し、呼び出し側にDB保存を
    スキップさせる（app/main.pyの/api/render、履歴の自動保存）。
    """
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        yield None
        return

    session = _get_session_factory()()
    try:
        yield session
    finally:
        session.close()
