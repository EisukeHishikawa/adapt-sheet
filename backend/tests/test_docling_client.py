from pathlib import Path

import pytest

from app.services.docling_client import (
    DoclingPDFConverter,
    PDFConversionError,
    get_pdf_converter,
)

# DEVELOPMENT.md ステップ7のTDD要件: 実装前に「テスト用PDFファイルを読み込ませたら、
# HTML文字列に変換されて抽出できるか」の期待値を先に定義する（Red状態）。
# scripts/verify_docling.pyで既に動作検証済みの同じsample.pdfを使い回すことで、
# 環境依存の問題（OS依存バイナリ/MLモデル）が既に解消済みであることを前提にできる。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"


def test_docling_converter_extracts_html_from_real_pdf():
    converter = DoclingPDFConverter()
    html = converter.convert_to_html("sample.pdf", SAMPLE_PDF.read_bytes())

    assert isinstance(html, str)
    # scripts/verify_docling.pyと同じ既知の埋め込みテキストが、HTML化後も残っていることを検証する。
    assert "Docling verification sample text" in html


def test_docling_converter_rejects_invalid_pdf_bytes():
    converter = DoclingPDFConverter()

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"not a real pdf content at all")


def test_get_pdf_converter_returns_docling_converter():
    # main.pyのDependsから差し替え可能にするためのファクトリ契約を検証する。
    assert isinstance(get_pdf_converter(), DoclingPDFConverter)
