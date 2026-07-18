"""Parameter Store からのAPIキー読み込み（app.secrets_loader、ADR-017）のテスト。

実SSMを叩かず、注入したフェイククライアントで挙動を検証する。ローカル/pytestでは
SSM_PARAMETER_PREFIX未設定のため常に no-op になることも合わせて確認する。
"""

import pytest

from app.secrets_loader import load_secrets_into_env


class _FakeSSM:
    """boto3のSSMクライアントの get_parameters だけを模す。呼び出し回数も数える。"""

    def __init__(self, params: dict) -> None:
        self._params = params
        self.calls = 0

    def get_parameters(self, Names, WithDecryption):  # noqa: N803 (boto3のAPI名に合わせる)
        self.calls += 1
        assert WithDecryption is True
        found = [{"Name": n, "Value": self._params[n]} for n in Names if n in self._params]
        invalid = [n for n in Names if n not in self._params]
        return {"Parameters": found, "InvalidParameters": invalid}


@pytest.fixture(autouse=True)
def _clear_secret_env(monkeypatch):
    # 各テストを他テストのプロセス内env汚染から隔離する。
    for name in ("SSM_PARAMETER_PREFIX", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)


def test_noop_when_prefix_unset(monkeypatch):
    called = False

    def factory():
        nonlocal called
        called = True
        return _FakeSSM({})

    load_secrets_into_env(ssm_client_factory=factory)

    # SSM_PARAMETER_PREFIX未設定（ローカル/pytest）ではSSMを一切呼ばない。
    assert called is False


def test_loads_keys_into_env(monkeypatch):
    monkeypatch.setenv("SSM_PARAMETER_PREFIX", "/adapt-sheet/prod")
    fake = _FakeSSM(
        {
            "/adapt-sheet/prod/GEMINI_API_KEY": "gem-secret",
            "/adapt-sheet/prod/ANTHROPIC_API_KEY": "ant-secret",
            "/adapt-sheet/prod/OPENAI_API_KEY": "oai-secret",
        }
    )

    load_secrets_into_env(ssm_client_factory=lambda: fake)

    import os

    assert os.environ["GEMINI_API_KEY"] == "gem-secret"
    assert os.environ["ANTHROPIC_API_KEY"] == "ant-secret"
    assert os.environ["OPENAI_API_KEY"] == "oai-secret"
    assert fake.calls == 1


def test_skips_ssm_when_keys_already_present(monkeypatch):
    monkeypatch.setenv("SSM_PARAMETER_PREFIX", "/adapt-sheet/prod")
    monkeypatch.setenv("GEMINI_API_KEY", "from-env")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "from-env")
    monkeypatch.setenv("OPENAI_API_KEY", "from-env")
    fake = _FakeSSM({"/adapt-sheet/prod/GEMINI_API_KEY": "should-not-be-used"})

    load_secrets_into_env(ssm_client_factory=lambda: fake)

    import os

    # 既に全キーがenvにある場合はSSMを叩かず、既存値を上書きもしない。
    assert fake.calls == 0
    assert os.environ["GEMINI_API_KEY"] == "from-env"


def test_missing_parameter_does_not_crash(monkeypatch):
    monkeypatch.setenv("SSM_PARAMETER_PREFIX", "/adapt-sheet/prod")
    # OPENAIだけ登録済み。残り2つはParameter Store未登録（InvalidParameters）。
    fake = _FakeSSM({"/adapt-sheet/prod/OPENAI_API_KEY": "oai-secret"})

    load_secrets_into_env(ssm_client_factory=lambda: fake)

    import os

    assert os.environ["OPENAI_API_KEY"] == "oai-secret"
    # 未登録のキーはenvへ書かれない（実利用時に app.ai_client 側が未設定として502を返す）。
    assert "GEMINI_API_KEY" not in os.environ
