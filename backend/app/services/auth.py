"""Supabase発行JWTの検証（DEVELOPMENT.md ステップ27）。

未ログインユーザーにも`/api/render`を開放し続ける方針（docs/spec.md）のため、検証失敗時は
例外を送出せずNoneを返す。呼び出し側（app/main.py）がNoneかどうかでゲート対象engineの
403判定を行う。

Supabase Authは従来のHS256共有シークレット方式に加えて、JWT Signing Keys機能（ES256等の
非対称鍵、JWKSで公開鍵を配布）をプロジェクトごとに選択できる（Supabase Local CLIは既定で
後者を発行する。ADR-018のトレードオフ、ADR-020）。トークンヘッダーの`alg`でどちらの方式かを
判別し、対応する検証経路へ振り分ける。
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import NamedTuple, Optional

import jwt
from fastapi import Header
from jwt import PyJWKClient

logger = logging.getLogger("app.auth")

# Supabase AuthのJWTは`aud: "authenticated"`を持つ（Supabase側の既定仕様）。
_EXPECTED_AUDIENCE = "authenticated"
_SHARED_SECRET_ALGORITHMS = frozenset({"HS256"})
_JWKS_ALGORITHMS = frozenset({"ES256", "RS256"})


class SupabaseUser(NamedTuple):
    sub: str
    email: Optional[str]


@lru_cache(maxsize=1)
def _get_jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url)


def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[SupabaseUser]:
    """AuthorizationヘッダーのSupabase JWTを検証し、成功時のみユーザー情報を返す。

    検証に必要な設定（SUPABASE_JWT_SECRET/SUPABASE_JWT_JWKS_URL）が未設定の場合は常にNoneを
    返す。ゲート対象engineは設定未完了のまま解禁されないようにするため、fail-closedをデフォルト
    挙動とする。
    """
    if not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None

    try:
        alg = jwt.get_unverified_header(token).get("alg")
    except jwt.PyJWTError:
        return None

    if alg in _SHARED_SECRET_ALGORITHMS:
        claims = _decode_with_shared_secret(token, alg)
    elif alg in _JWKS_ALGORITHMS:
        claims = _decode_with_jwks(token, alg)
    else:
        claims = None

    if claims is None:
        return None

    sub = claims.get("sub")
    if not sub:
        return None
    return SupabaseUser(sub=sub, email=claims.get("email"))


def _decode_with_shared_secret(token: str, alg: str) -> Optional[dict]:
    secret = os.getenv("SUPABASE_JWT_SECRET", "").strip()
    if not secret:
        return None
    try:
        return jwt.decode(token, secret, algorithms=[alg], audience=_EXPECTED_AUDIENCE)
    except jwt.PyJWTError as exc:
        # トークンの中身は機微情報のためログへ出さない（ADR-011）。失敗理由のみ残す。
        logger.info("Supabase JWT検証に失敗しました", extra={"reason": str(exc)})
        return None


def _decode_with_jwks(token: str, alg: str) -> Optional[dict]:
    jwks_url = os.getenv("SUPABASE_JWT_JWKS_URL", "").strip()
    if not jwks_url:
        return None
    try:
        signing_key = _get_jwks_client(jwks_url).get_signing_key_from_jwt(token)
        return jwt.decode(token, signing_key.key, algorithms=[alg], audience=_EXPECTED_AUDIENCE)
    except jwt.PyJWTError as exc:
        logger.info("Supabase JWT検証に失敗しました", extra={"reason": str(exc)})
        return None
    except Exception as exc:  # JWKS取得時のネットワークエラー等、PyJWTError以外も握りつぶす
        logger.warning("SupabaseのJWKS取得に失敗しました", extra={"reason": str(exc)})
        return None
