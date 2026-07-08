from pathlib import Path

import pytest

from app.converter import DoclingPDFConverter, PDFConversionError

# ADR-018によりbackend/tests/test_docling_client.pyから移動。DoclingPDFConverter自体の
# 変換ロジックはステップ7から変わっていないため、テスト内容もそのまま引き継ぐ。
# scripts/verify_docling.pyと同じ既知の埋め込みテキストを含むサンプルPDFを使い回す。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"


def test_docling_converter_extracts_html_from_real_pdf():
    converter = DoclingPDFConverter()
    html = converter.convert_to_html("sample.pdf", SAMPLE_PDF.read_bytes())

    assert isinstance(html, str)
    assert "Docling verification sample text" in html


def test_docling_converter_rejects_invalid_pdf_bytes():
    converter = DoclingPDFConverter()

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"not a real pdf content at all")
