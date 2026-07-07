import pytest
import requests

from app.services.ai_client import (
    AIGenerationError,
    LlamaAIClient,
    MockAIClient,
    RenderResult,
    build_prompt,
    get_ai_client,
    parse_gemini_response,
    validate_render_result,
)

# DEVELOPMENT.md ステップ6のTDD要件: ai_client.py実装前に、
# 「プレースホルダーを含むHTML/CSS/JSONが厳格に返ってくるか」の期待値を先に定義する（Red状態）。


def test_build_prompt_includes_context():
    prompt = build_prompt(
        html="<p>old</p>",
        css="body{}",
        json_data={"a": 1},
        prompt="請求書のレイアウトにして",
        width_mm=210,
        height_mm=297,
    )
    # 動的プロンプトに入力コンテキスト（サイズ・自然言語指示）が反映されていることを検証する。
    assert "請求書のレイアウトにして" in prompt
    assert "210" in prompt and "297" in prompt


def test_mock_client_returns_valid_render_result():
    client = MockAIClient()
    prompt = build_prompt(html="", css="", json_data={}, prompt="サンプル", width_mm=None, height_mm=None)
    result = client.generate(prompt)

    assert isinstance(result, RenderResult)
    # モックが返す結果も本番同様に厳格なバリデーションをパスする契約を保証する。
    validate_render_result(result)


def test_validate_render_result_rejects_empty_html():
    bad = RenderResult(html="", css="body{}", data={})
    with pytest.raises(AIGenerationError):
        validate_render_result(bad)


def test_validate_render_result_rejects_non_dict_json():
    bad = RenderResult(html="<p>ok</p>", css="body{}", data=[])  # type: ignore[arg-type]
    with pytest.raises(AIGenerationError):
        validate_render_result(bad)


def test_validate_render_result_rejects_placeholder_without_json_key():
    # CLAUDE.mdの「固定情報と業務データの分離」規約: htmlの{{key}}はjsonに対応キーが必須。
    bad = RenderResult(html="<p>{{missing_key}}</p>", css="body{}", data={})
    with pytest.raises(AIGenerationError):
        validate_render_result(bad)


def test_validate_render_result_accepts_matching_placeholder():
    ok = RenderResult(html="<p>{{name}}</p>", css="body{}", data={"name": "value"})
    validate_render_result(ok)  # 例外が発生しなければOK


def test_get_ai_client_defaults_to_mock(monkeypatch):
    # ADR-007: 環境変数未設定時はテスト・ローカル開発を安全にするためモックを既定にする。
    monkeypatch.delenv("USE_MOCK_AI", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    assert isinstance(get_ai_client(), MockAIClient)


def test_get_ai_client_raises_when_real_requested_without_key(monkeypatch):
    # USE_MOCK_AI=falseで実APIを明示指定したのにAPIキーが無い場合は、
    # 実行時エラーではなく起動直後にAIGenerationErrorとして検知させる。
    monkeypatch.setenv("USE_MOCK_AI", "false")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(AIGenerationError):
        get_ai_client()


# DEVELOPMENT.md ステップ10のTDD要件: pytestのデフォルト経路（MockAIClient）を変えずに、
# ローカル開発用の第三の経路（Llama 3.2 3B / Ollama）を環境変数で選択できることを検証する。


def test_get_ai_client_defaults_to_mock_even_when_ai_provider_is_llama(monkeypatch):
    # USE_MOCK_AI未設定（pytestの既定挙動）であれば、AI_PROVIDERが設定されていても
    # MockAIClientのままであることを保証する。これがステップ10の必須要件。
    monkeypatch.delenv("USE_MOCK_AI", raising=False)
    monkeypatch.setenv("AI_PROVIDER", "llama")

    assert isinstance(get_ai_client(), MockAIClient)


def test_get_ai_client_selects_llama_when_provider_is_llama(monkeypatch):
    # USE_MOCK_AI=false かつ AI_PROVIDER=llama の場合、GEMINI_API_KEYが無くても
    # LlamaAIClientが選択される（Ollamaはローカル実行のためAPIキー不要）。
    monkeypatch.setenv("USE_MOCK_AI", "false")
    monkeypatch.setenv("AI_PROVIDER", "llama")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    assert isinstance(get_ai_client(), LlamaAIClient)


def test_get_ai_client_defaults_provider_to_gemini_when_unset(monkeypatch):
    # AI_PROVIDER未設定時は、ステップ9までの挙動（Geminiが既定でGEMINI_API_KEY必須）を
    # 変更しないことを確認する。
    monkeypatch.setenv("USE_MOCK_AI", "false")
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(AIGenerationError):
        get_ai_client()


class _FakeOllamaResponse:
    """requests.Responseの代わりに使う最小限のフェイク（ネットワーク呼び出しなしでテストするため）。"""

    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return self._payload


def test_llama_client_generate_parses_ollama_response(monkeypatch):
    # OllamaのREST API（/api/generate）は {"response": "<JSON文字列>", ...} 形式で返す。
    # LlamaAIClientはこのresponseフィールドをGeminiと同じ契約でパースすることを検証する。
    captured = {}

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["timeout"] = timeout
        return _FakeOllamaResponse(
            {"response": '{"html": "<p>{{name}}</p>", "css": "body{}", "json": {"name": "value"}}'}
        )

    monkeypatch.setattr(requests, "post", fake_post)

    client = LlamaAIClient()
    result = client.generate("dummy prompt")

    assert captured["url"] == "http://localhost:11434/api/generate"
    assert captured["json"]["model"] == "llama3.2:3b"
    assert isinstance(result, RenderResult)
    assert result.html == "<p>{{name}}</p>"
    assert result.data == {"name": "value"}


def test_llama_client_respects_ollama_base_url_env(monkeypatch):
    # ローカル以外のポート・ホストでOllamaを動かす場合に備え、OLLAMA_BASE_URLで
    # 接続先を上書きできることを検証する。
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://127.0.0.1:22222")
    captured = {}

    def fake_post(url, json, timeout):
        captured["url"] = url
        return _FakeOllamaResponse({"response": '{"html": "<p>ok</p>", "css": "body{}", "json": {}}'})

    monkeypatch.setattr(requests, "post", fake_post)

    LlamaAIClient().generate("dummy prompt")

    assert captured["url"] == "http://127.0.0.1:22222/api/generate"


def test_llama_client_wraps_connection_error(monkeypatch):
    # Ollamaが起動していない場合の接続エラーを、他経路と同じAIGenerationErrorに変換することを検証する。
    def fake_post(url, json, timeout):
        raise requests.ConnectionError("connection refused")

    monkeypatch.setattr(requests, "post", fake_post)

    with pytest.raises(AIGenerationError):
        LlamaAIClient().generate("dummy prompt")


# ADR-010: AnthropicからGemini APIへの移行に伴うテスト。
# GeminiAIClient.generate自体は実ネットワーク呼び出しを伴うため単体テストの対象にせず、
# レスポンス解析ロジック（parse_gemini_response）を純粋関数として切り出してテストする。


def test_parse_gemini_response_parses_plain_json():
    text = '{"html": "<p>{{name}}</p>", "css": "body{}", "json": {"name": "value"}}'
    result = parse_gemini_response(text)

    assert isinstance(result, RenderResult)
    assert result.html == "<p>{{name}}</p>"
    assert result.data == {"name": "value"}


def test_parse_gemini_response_strips_code_fence():
    # Geminiはプロンプトでコードブロック記法不要と指示しても、
    # ```json ... ``` で囲んで返すことがあるため、フェンス除去が必須。
    text = '```json\n{"html": "<p>ok</p>", "css": "body{}", "json": {}}\n```'
    result = parse_gemini_response(text)

    assert result.html == "<p>ok</p>"


def test_parse_gemini_response_rejects_invalid_json():
    with pytest.raises(AIGenerationError):
        parse_gemini_response("not a json")


def test_parse_gemini_response_rejects_missing_keys():
    with pytest.raises(AIGenerationError):
        parse_gemini_response('{"html": "<p>ok</p>"}')
