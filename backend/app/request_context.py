"""リクエスト相関ID（request_id）をリクエストスコープで持ち回るためのコンテキスト（ADR-016）。

ミドルウェア（app/middleware.py）がリクエスト毎にrequest_idを採番してここへ設定し、
- ログフォーマッタ（app/logging_config.py）が全ログレコードへ自動付与し、
- 例外ハンドラ（app/errors.py）がエラーレスポンスボディへ埋め込む、
という形で「画面表示・レスポンスヘッダー・サーバーログ」の相関を実現する。
FastAPIのDIやグローバル変数ではなくcontextvarを使うのは、非同期リクエストが並行しても
リクエストごとに独立した値を安全に保持できるようにするため。
"""

from __future__ import annotations

import contextvars
from typing import Optional

# default=Noneにすることで、ミドルウェアを通らない経路（起動時処理・単体呼び出し等）でも
# get時に例外にならず「相関IDなし」を表現できるようにする。
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
    """set_request_idで得たトークンを使い、前の値へ確実に戻す（リクエスト間の値漏れ防止）。"""
    _request_id_ctx.reset(token)
