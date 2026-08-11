"""描画エンジンのレジストリ（app/services/engines.py）の検証。

エンジンを1行追加したときに、ゲート判定・PDF必須・無料枠カウント・AIクライアント生成の
どれかを更新し忘れたら落ちるようにしておく。
"""

import pytest

from app.services.ai_client import MockAIClient, get_ai_client
from app.services.engines import (
    AI_ENGINES,
    ALL_ENGINES,
    CONVERTER_ENGINES,
    ENGINE_SPECS,
    GATED_ENGINES,
    GEMINI_FREE_QUOTA_ENGINES,
    PDF_REQUIRED_ENGINES,
)


def test_registry_lists_every_engine_exactly_once():
    names = [spec.name for spec in ENGINE_SPECS]
    assert len(names) == len(set(names))
    assert ALL_ENGINES == set(names)


def test_derived_sets_match_the_registry():
    assert GATED_ENGINES == {"gemini", "claude", "openai"}
    assert AI_ENGINES == {"gemini_free", "gemini", "claude", "openai", "hybrid"}
    assert CONVERTER_ENGINES == {"docling", "pdf2htmlex", "pymupdf"}
    assert PDF_REQUIRED_ENGINES == {"hybrid", "docling", "pdf2htmlex", "pymupdf"}
    assert GEMINI_FREE_QUOTA_ENGINES == {"gemini_free", "hybrid"}


def test_ai_and_converter_engines_partition_all_engines():
    assert AI_ENGINES | CONVERTER_ENGINES == ALL_ENGINES
    assert not (AI_ENGINES & CONVERTER_ENGINES)


@pytest.mark.parametrize("engine", sorted(AI_ENGINES))
def test_every_ai_engine_can_build_a_real_client(engine, monkeypatch):
    """レジストリへAIエンジンを足したのに、実クライアントの生成を書き忘れると落ちる。"""
    monkeypatch.setenv("USE_MOCK_AI", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setenv("OPENAI_API_KEY", "dummy")

    client = get_ai_client(engine)

    assert not isinstance(client, MockAIClient)
    assert hasattr(client, "generate")
