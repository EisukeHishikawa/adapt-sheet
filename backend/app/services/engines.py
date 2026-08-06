"""描画エンジンのレジストリ。

エンジンごとの属性（ゲート・PDF必須・無料枠カウント等）をENGINE_SPECSの1行に集約し、
判定に使う集合はすべてそこから導出する。エンジンの追加・変更はこの表の1行で完結させ、
判定ごとに列挙を書き足さない。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, FrozenSet


@dataclass(frozen=True)
class EngineSpec:
    name: str
    # LLMがHTML/CSS/JSONを生成する。falseはAIを介さず変換結果をそのまま描画結果にするエンジン。
    uses_ai: bool
    # 無料枠を超えるAPI利用が発生するため、ログイン済みユーザーにのみ提供する。
    gated: bool
    # 変換対象、またはhybridの統合入力としてPDFそのものが要る。
    requires_pdf: bool
    # gemini_freeと同じ無料枠モデルを使うため、全ユーザー共有の日次カウンタの対象になる。
    counts_free_quota: bool


ENGINE_SPECS: tuple[EngineSpec, ...] = (
    EngineSpec("gemini_free", uses_ai=True, gated=False, requires_pdf=False, counts_free_quota=True),
    EngineSpec("gemini", uses_ai=True, gated=True, requires_pdf=False, counts_free_quota=False),
    EngineSpec("claude", uses_ai=True, gated=True, requires_pdf=False, counts_free_quota=False),
    EngineSpec("openai", uses_ai=True, gated=True, requires_pdf=False, counts_free_quota=False),
    EngineSpec("hybrid", uses_ai=True, gated=False, requires_pdf=True, counts_free_quota=True),
    EngineSpec("docling", uses_ai=False, gated=False, requires_pdf=True, counts_free_quota=False),
    EngineSpec("pdf2htmlex", uses_ai=False, gated=False, requires_pdf=True, counts_free_quota=False),
    EngineSpec("pymupdf", uses_ai=False, gated=False, requires_pdf=True, counts_free_quota=False),
)


def _names_where(predicate: Callable[[EngineSpec], bool]) -> FrozenSet[str]:
    return frozenset(spec.name for spec in ENGINE_SPECS if predicate(spec))


# 未知のengine値をPDF読み込み等の重い処理より前に弾くための許可リスト。
ALL_ENGINES: FrozenSet[str] = _names_where(lambda spec: True)
AI_ENGINES: FrozenSet[str] = _names_where(lambda spec: spec.uses_ai)
CONVERTER_ENGINES: FrozenSet[str] = _names_where(lambda spec: not spec.uses_ai)
GATED_ENGINES: FrozenSet[str] = _names_where(lambda spec: spec.gated)
PDF_REQUIRED_ENGINES: FrozenSet[str] = _names_where(lambda spec: spec.requires_pdf)
GEMINI_FREE_QUOTA_ENGINES: FrozenSet[str] = _names_where(lambda spec: spec.counts_free_quota)
