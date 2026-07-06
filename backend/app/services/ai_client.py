"""Claude API (Anthropic SDK) 統合レイヤー（DEVELOPMENT.md ステップ6）。

ADR-007に基づき、本番用のAnthropicAIClientとテスト/ローカル開発用のMockAIClientを
同一インターフェース（AIClient）で切り替えられるようにし、pytest実行時・ローカル開発時に
実際のAnthropic APIを誤って消費しない構成にする。
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Optional, Protocol

import anthropic

# htmlのテンプレート変数 {{key}} を抽出する正規表現。
# CLAUDE.mdの「固定情報と業務データの分離」規約に基づき、これらのkeyは
# 必ずレスポンスのjsonに存在することをvalidate_render_resultで検証する。
_PLACEHOLDER_PATTERN = re.compile(r"\{\{(\w+)\}\}")


class AIGenerationError(Exception):
    """AI生成に失敗した場合の例外。

    docs/spec.mdのエラーコード定義に合わせ、呼び出し側（app/main.py）で
    502 Bad Gatewayへ変換することを想定する。
    """


@dataclass
class RenderResult:
    """AIクライアントの生成結果。app/main.pyのRenderResponseへ詰め替えて返却する。"""

    html: str
    css: str
    data: dict = field(default_factory=dict)


class AIClient(Protocol):
    """モック/本番を問わず共通のインターフェース。FastAPIのDependsで差し替え可能にする。"""

    def generate(self, prompt: str) -> RenderResult: ...


def build_prompt(
    *,
    html: str,
    css: str,
    json_data: dict,
    prompt: str,
    width_mm: Optional[float],
    height_mm: Optional[float],
) -> str:
    """docs/spec.md 3.1のリクエスト項目から、Claudeへの動的プロンプトを構築する。

    既存のhtml/css/jsonをコンテキストとして渡し、固定テキストと業務データ（テンプレート変数）を
    分離する規約（CLAUDE.md）をプロンプト内で明示することで、モック/本番の双方で
    同じ形式のレスポンスが得られるようにする。
    """
    size_line = ""
    if width_mm is not None and height_mm is not None:
        size_line = f"帳票サイズ: 横{width_mm}mm × 縦{height_mm}mm\n"

    return (
        "あなたはHTML/CSS帳票の生成アシスタントです。"
        "以下の情報をもとに、保守しやすいHTML/CSSと、それに対応する業務データのJSONを生成してください。\n"
        f"{size_line}"
        f"既存HTML:\n{html}\n\n"
        f"既存CSS:\n{css}\n\n"
        f"既存の業務データJSON:\n{json.dumps(json_data, ensure_ascii=False)}\n\n"
        f"生成方針（自然言語指示）: {prompt}\n\n"
        "出力は次のJSON形式のみで返してください（説明文やコードブロック記法は不要）:\n"
        '{"html": "...", "css": "...", "json": {...}}\n'
        "タイトル等の固定テキストはHTMLに直接記述し、明細等の業務データのみを"
        "{{key}}形式のテンプレート変数としてHTMLに埋め込み、対応するキーをjsonに含めてください。"
    )


def validate_render_result(result: RenderResult) -> None:
    """レスポンス契約（docs/spec.md 3.1）とテンプレート変数の整合性を厳格に検証する。

    モック・本番どちらの経路で生成された結果でも同じ契約を満たす必要があるため、
    app/main.py側ではなくこの共通関数で検証する。
    """
    if not isinstance(result.html, str) or not result.html.strip():
        raise AIGenerationError("AI生成結果のhtmlが空、または文字列ではありません")
    if not isinstance(result.css, str) or not result.css.strip():
        raise AIGenerationError("AI生成結果のcssが空、または文字列ではありません")
    if not isinstance(result.data, dict):
        raise AIGenerationError("AI生成結果のjsonがオブジェクト形式ではありません")

    placeholders = set(_PLACEHOLDER_PATTERN.findall(result.html))
    missing = placeholders - set(result.data.keys())
    if missing:
        raise AIGenerationError(
            "htmlのテンプレート変数がjsonに存在しません: " + ", ".join(sorted(missing))
        )


class MockAIClient:
    """ADR-007のモック層。実APIを叩かず、プロンプト内容に応じた疑似レスポンスを返す。

    プロンプトの内容自体で分岐はしないが、末尾にプロンプトの一部をコメントとして
    埋め込むことで、実際に呼び出しが行われたことをテスト・デバッグ時に確認しやすくする。
    """

    def generate(self, prompt: str) -> RenderResult:
        prompt_preview = prompt.strip().replace("\n", " ")[:50]
        return RenderResult(
            html=(
                "<!doctype html><html><body>"
                f"<!-- mock generated from prompt: {prompt_preview} -->"
                "<h1>帳票タイトル</h1>"
                "<p>{{customer_name}}</p>"
                "</body></html>"
            ),
            css="body { font-family: sans-serif; }",
            data={"customer_name": "モック太郎"},
        )


class AnthropicAIClient:
    """本番用のAnthropic SDKクライアント。USE_MOCK_AI=false かつ ANTHROPIC_API_KEY設定時のみ使用する。"""

    # Claude Sonnet系の最新世代を既定モデルとする。将来のモデル更新時はここを変更する。
    _MODEL = "claude-sonnet-4-5"

    def __init__(self, api_key: str) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)

    def generate(self, prompt: str) -> RenderResult:
        try:
            response = self._client.messages.create(
                model=self._MODEL,
                max_tokens=4096,
                messages=[{"role": "user", "content": prompt}],
            )
        except anthropic.APIError as exc:
            # docs/spec.md: Claude API呼び出し失敗は502として扱うため、専用例外に変換する。
            raise AIGenerationError(f"Anthropic API呼び出しに失敗しました: {exc}") from exc

        text = "".join(
            block.text for block in response.content if getattr(block, "type", None) == "text"
        )

        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise AIGenerationError(f"AIレスポンスがJSON形式ではありません: {exc}") from exc

        try:
            return RenderResult(html=payload["html"], css=payload["css"], data=payload["json"])
        except KeyError as exc:
            raise AIGenerationError(f"AIレスポンスに必須キーが不足しています: {exc}") from exc


def get_ai_client() -> AIClient:
    """FastAPIのDependsとして利用するファクトリ。

    ADR-007に基づき、USE_MOCK_AI未設定時はテスト・ローカル開発を安全にするため
    既定でモックを返す。実APIを使うには USE_MOCK_AI=false を明示し、
    かつ ANTHROPIC_API_KEY を設定する必要がある（両方揃わない限り実APIは呼ばれない）。
    """
    use_mock = os.getenv("USE_MOCK_AI", "true").strip().lower() not in ("false", "0", "no")
    if use_mock:
        return MockAIClient()

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise AIGenerationError(
            "USE_MOCK_AI=false が指定されていますが ANTHROPIC_API_KEY が未設定です"
        )
    return AnthropicAIClient(api_key=api_key)
