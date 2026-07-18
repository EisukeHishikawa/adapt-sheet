"""リクエスト相関ID（request_id）をリクエストスコープで持ち回るコンテキスト（ADR-012）。

グローバル変数ではなくcontextvarを使うのは、非同期リクエストが並行してもリクエストごとに
独立した値を安全に保持するため。
"""

from __future__ import annotations

import contextvars
from typing import Optional

# default=Noneにすることで、ミドルウェアを通らない経路（起動時処理・単体呼び出し等）でも
# 例外にならず「相関IDなし」を表現できる。
_request_id_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "request_id", default=None
)


def get_request_id() -> Optional[str]:
    """現在のリクエストの相関IDを返す。リクエスト外ではNone。"""
    return _request_id_ctx.get()


def set_request_id(request_id: str) -> contextvars.Token:
    """相関IDを設定し、リセット用トークンを返す（呼び出し側がfinallyでresetする）。"""
    return _request_id_ctx.set(request_id)


def reset_request_id(token: contextvars.Token) -> None:
    """トークンを使って前の値へ戻す（リクエスト間の値漏れ防止）。"""
    _request_id_ctx.reset(token)
