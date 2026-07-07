"""Gemini API (google-genai SDK) 統合レイヤー（DEVELOPMENT.md ステップ6→ステップ9でGeminiへ移行）。

ADR-007に基づき、本番用のGeminiAIClientとテスト/ローカル開発用のMockAIClientを
同一インターフェース（AIClient）で切り替えられるようにし、pytest実行時・ローカル開発時に
実際のGemini APIを誤って消費しない構成にする。ADR-010の決定に基づき、旧AnthropicAIClientは
削除しGeminiへ完全置換した。ADR-011に基づき、ステップ10でローカル開発用の第三の経路として
Ollama経由のLlamaAIClientを追加した（pytestの既定はMockAIClientのまま変更しない）。
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Optional, Protocol

import requests
from google import genai
from google.genai import errors as genai_errors

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


def parse_gemini_response(text: str) -> RenderResult:
    """Geminiのレスポンステキストをdocs/spec.md 3.1の契約に沿ってパースする。

    Anthropicではプロンプト指示のみでコードブロック記法なしのJSONが安定して返っていたが、
    Geminiは同じ指示でも```json ... ```のコードフェンスで囲んで返すことがあるため、
    ここでフェンス除去を行ってからパースする。GeminiAIClientから分離した純粋関数にすることで、
    実際のAPI呼び出し（ネットワーク）なしにレスポンス解析ロジックだけを単体テストできるようにする。
    レスポンス契約（{"html", "css", "json"}）はプロバイダー非依存のため、
    ステップ10で追加したLlamaAIClient（Ollama）のレスポンス解析にもそのまま流用する。
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\n", "", cleaned)
        cleaned = re.sub(r"\n```$", "", cleaned)

    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise AIGenerationError(f"AIレスポンスがJSON形式ではありません: {exc}") from exc

    try:
        return RenderResult(html=payload["html"], css=payload["css"], data=payload["json"])
    except KeyError as exc:
        raise AIGenerationError(f"AIレスポンスに必須キーが不足しています: {exc}") from exc


class GeminiAIClient:
    """本番用のGemini SDKクライアント（ADR-010）。USE_MOCK_AI=false かつ GEMINI_API_KEY設定時のみ使用する。"""

    # 無料枠で利用できる高速モデルを既定とする。将来のモデル更新時はここを変更する。
    _MODEL = "gemini-2.0-flash"

    def __init__(self, api_key: str) -> None:
        self._client = genai.Client(api_key=api_key)

    def generate(self, prompt: str) -> RenderResult:
        try:
            response = self._client.models.generate_content(model=self._MODEL, contents=prompt)
        except genai_errors.APIError as exc:
            # docs/spec.md: Gemini API呼び出し失敗は502として扱うため、専用例外に変換する。
            raise AIGenerationError(f"Gemini API呼び出しに失敗しました: {exc}") from exc

        return parse_gemini_response(response.text or "")


class LlamaAIClient:
    """ローカル開発用のOllama（llama3.2:3b）クライアント（ADR-011、DEVELOPMENT.md ステップ10）。

    pytestで使うMockAIClientの決定論的な契約は変更せず、ローカルで無料・オフラインに
    AI生成のバリエーションを手元で確認するための第三の経路として追加する。Ollamaは
    APIキー不要でローカルホストのREST APIとして動作するため、GeminiAIClientと異なり
    認証情報は扱わない。
    """

    _MODEL = "llama3.2:3b"
    _DEFAULT_BASE_URL = "http://localhost:11434"

    def __init__(self, base_url: Optional[str] = None) -> None:
        # OLLAMA_BASE_URLで接続先を上書きできるようにし、Ollamaを別ポート/別ホストで
        # 動かす開発者環境にも対応する。
        resolved = base_url or os.getenv("OLLAMA_BASE_URL") or self._DEFAULT_BASE_URL
        self._base_url = resolved.rstrip("/")

    def generate(self, prompt: str) -> RenderResult:
        try:
            response = requests.post(
                f"{self._base_url}/api/generate",
                json={
                    "model": self._MODEL,
                    "prompt": prompt,
                    "stream": False,
                    # OllamaのJSON強制出力を使い、Geminiと同じ{"html", "css", "json"}契約に
                    # 沿ったレスポンスを安定して得る。
                    "format": "json",
                },
                timeout=120,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            # docs/spec.md: AI生成の呼び出し失敗は502として扱うため、他経路と同じ専用例外に変換する。
            raise AIGenerationError(f"Ollama(Llama 3.2 3B)呼び出しに失敗しました: {exc}") from exc

        return parse_gemini_response(response.json().get("response", ""))


def get_ai_client() -> AIClient:
    """FastAPIのDependsとして利用するファクトリ。

    ADR-007に基づき、USE_MOCK_AI未設定時はテスト・ローカル開発を安全にするため
    既定でモックを返す。実生成を使うには USE_MOCK_AI=false を明示する必要がある。
    その上でAI_PROVIDER（既定gemini）により実経路を選択する。ADR-011に基づき、
    AI_PROVIDER=llama を指定するとAPIキー不要のローカルOllama経路（LlamaAIClient）を、
    それ以外はGEMINI_API_KEYを要求するGeminiAIClientを使う。
    """
    use_mock = os.getenv("USE_MOCK_AI", "true").strip().lower() not in ("false", "0", "no")
    if use_mock:
        return MockAIClient()

    provider = os.getenv("AI_PROVIDER", "gemini").strip().lower()
    if provider == "llama":
        return LlamaAIClient()

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise AIGenerationError(
            "USE_MOCK_AI=false が指定されていますが GEMINI_API_KEY が未設定です"
        )
    return GeminiAIClient(api_key=api_key)
