"""Supabase発行JWTの検証（DEVELOPMENT.md ステップ27）。

未ログインユーザーにも`/api/render`を開放し続ける方針（docs/spec.md）のため、検証失敗時は
例外を送出せずNoneを返す。呼び出し側（app/main.py）がNoneかどうかでゲート対象engineの
403判定を行う。
"""

from __future__ import annotations

import logging
import os
from typing import NamedTuple, Optional

import jwt
from fastapi import Header

logger = logging.getLogger("app.auth")

# Supabase AuthのJWTは`aud: "authenticated"`を持つ（Supabase側の既定仕様）。
_EXPECTED_AUDIENCE = "authenticated"


class SupabaseUser(NamedTuple):
    sub: str
    email: Optional[str]


def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[SupabaseUser]:
    """AuthorizationヘッダーのSupabase JWTを検証し、成功時のみユーザー情報を返す。

    SUPABASE_JWT_SECRET未設定（ローカル/pytestの既定）では常にNoneを返す。ゲート対象engineは
    シークレット未設定のまま解禁されないようにするため、fail-closedをデフォルト挙動とする。
    """
    secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()
    if not secret or not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None

    try:
        claims = jwt.decode(token, secret, algorithms=["HS256"], audience=_EXPECTED_AUDIENCE)
    except jwt.PyJWTError as exc:
        # トークンの中身は機微情報のためログへ出さない（ADR-011）。失敗理由のみ残す。
        logger.info("Supabase JWT検証に失敗しました", extra={"reason": str(exc)})
        return None

    sub = claims.get("sub")
    if not sub:
        return None
    return SupabaseUser(sub=sub, email=claims.get("email"))
