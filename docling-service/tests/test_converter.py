from pathlib import Path

import pytest

from app.converter import DoclingPDFConverter, PDFConversionError

# ADR-019: DoclingはHTML変換ではなくテキスト抽出（Markdown）を担う。
# scripts/verify_docling.pyと同じ既知の埋め込みテキストを含むサンプルPDFを使い回す。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"


def test_docling_converter_extracts_markdown_from_real_pdf():
    converter = DoclingPDFConverter()
    markdown = converter.convert_to_markdown("sample.pdf", SAMPLE_PDF.read_bytes())

    assert isinstance(markdown, str)
    assert "Docling verification sample text" in markdown
    # レイアウトの再現はPyMuPDF（backend内）側の責務のため、HTML文書として返さないこと（ADR-019）。
    assert "<html" not in markdown.lower()


def test_docling_converter_rejects_invalid_pdf_bytes():
    converter = DoclingPDFConverter()

    with pytest.raises(PDFConversionError):
        converter.convert_to_markdown("broken.pdf", b"not a real pdf content at all")
