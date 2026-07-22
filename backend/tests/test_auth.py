"""Supabase発行JWTの検証（app.services.auth、DEVELOPMENT.md ステップ27）のテスト。

実Supabaseプロジェクトには接続せず、SUPABASE_JWT_SECRETと同じ鍵でPyJWTが自前で
署名したトークンを使い、検証ロジック単体を確認する。JWKS/ES256経路（ADR-020）は
実際のネットワーク越しのJWKS取得を行わず、PyJWKClientをフェイクに差し替えて検証する。
"""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

import app.services.auth as auth_module
from app.services.auth import get_current_user

_SECRET = "test-secret-for-supabase-jwt"
_JWKS_URL = "https://example.test/auth/v1/.well-known/jwks.json"


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


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJWKSClient:
    def __init__(self, key):
        self._key = key

    def get_signing_key_from_jwt(self, token):
        return _FakeSigningKey(self._key)


def _make_es256_token(*, private_key, sub: str = "user-789", exp_delta: int = 3600, **extra) -> str:
    payload = {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + exp_delta, **extra}
    return jwt.encode(payload, private_key, algorithm="ES256")


@pytest.fixture
def _es256_keypair():
    private_key = ec.generate_private_key(ec.SECP256R1())
    return private_key, private_key.public_key()


@pytest.fixture(autouse=True)
def _set_jwks_url(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_JWKS_URL", _JWKS_URL)


def test_returns_user_for_valid_jwks_token(monkeypatch, _es256_keypair):
    private_key, public_key = _es256_keypair
    monkeypatch.setattr(auth_module, "_get_jwks_client", lambda url: _FakeJWKSClient(public_key))
    token = _make_es256_token(private_key=private_key, sub="user-789", email="jwks@example.com")

    user = get_current_user(authorization=f"Bearer {token}")

    assert user is not None
    assert user.sub == "user-789"
    assert user.email == "jwks@example.com"


def test_returns_none_for_jwks_token_with_wrong_key(monkeypatch, _es256_keypair):
    private_key, _ = _es256_keypair
    other_public_key = ec.generate_private_key(ec.SECP256R1()).public_key()
    monkeypatch.setattr(auth_module, "_get_jwks_client", lambda url: _FakeJWKSClient(other_public_key))
    token = _make_es256_token(private_key=private_key)

    assert get_current_user(authorization=f"Bearer {token}") is None


def test_returns_none_for_jwks_token_when_url_unset(monkeypatch, _es256_keypair):
    private_key, _ = _es256_keypair
    monkeypatch.delenv("SUPABASE_JWT_JWKS_URL", raising=False)
    token = _make_es256_token(private_key=private_key)

    assert get_current_user(authorization=f"Bearer {token}") is None


def test_returns_none_for_unsupported_algorithm():
    token = jwt.encode({"sub": "user-1", "aud": "authenticated"}, "some-secret", algorithm="HS512")

    assert get_current_user(authorization=f"Bearer {token}") is None
