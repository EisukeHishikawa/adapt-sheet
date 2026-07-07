import pytest

from app.services.ai_client import (
    AIGenerationError,
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
