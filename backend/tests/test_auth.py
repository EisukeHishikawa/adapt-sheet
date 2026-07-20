"""Supabase発行JWTの検証（app.services.auth、DEVELOPMENT.md ステップ27）のテスト。

実Supabaseプロジェクトには接続せず、SUPABASE_JWT_SECRETと同じ鍵でPyJWTが自前で
署名したトークンを使い、検証ロジック単体を確認する。
"""

import time

import jwt
import pytest

from app.services.auth import get_current_user

_SECRET = "test-secret-for-supabase-jwt"


@pytest.fixture(autouse=True)
def _set_secret(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", _SECRET)


def _make_token(*, secret: str = _SECRET, sub: str = "user-123", exp_delta: int = 3600, **extra) -> str:
    payload = {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + exp_delta, **extra}
    return jwt.encode(payload, secret, algorithm="HS256")


def test_returns_none_when_header_missing():
    assert get_current_user(authorization=None) is None


def test_returns_none_when_secret_unset(monkeypatch):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    token = _make_token()

    assert get_current_user(authorization=f"Bearer {token}") is None


def test_returns_none_for_non_bearer_scheme():
    token = _make_token()
    assert get_current_user(authorization=f"Basic {token}") is None


def test_returns_none_for_invalid_signature():
    token = _make_token(secret="wrong-secret")
    assert get_current_user(authorization=f"Bearer {token}") is None


def test_returns_none_for_expired_token():
    token = _make_token(exp_delta=-60)
    assert get_current_user(authorization=f"Bearer {token}") is None


def test_returns_none_for_wrong_audience():
    token = _make_token(aud="other-audience")
    assert get_current_user(authorization=f"Bearer {token}") is None


def test_returns_user_for_valid_token():
    token = _make_token(sub="user-456", email="user@example.com")

    user = get_current_user(authorization=f"Bearer {token}")

    assert user is not None
    assert user.sub == "user-456"
    assert user.email == "user@example.com"
