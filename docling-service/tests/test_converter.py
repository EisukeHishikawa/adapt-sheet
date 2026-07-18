from pathlib import Path

import pytest

from app.converter import DoclingPDFConverter, PDFConversionError

# ADR-016: DoclingはHTML変換（テキスト・論理構造の抽出結果をそのままHTMLとして返す）を担う。
# scripts/verify_docling.pyと同じ既知の埋め込みテキストを含むサンプルPDFを使い回す。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"


def test_docling_converter_extracts_html_from_real_pdf():
    converter = DoclingPDFConverter()
    html = converter.convert_to_html("sample.pdf", SAMPLE_PDF.read_bytes())

    assert isinstance(html, str)
    assert "Docling verification sample text" in html
    # ADR-016: 単独のHTMLエンジンとしてそのまま描画結果になるため、html文書として返す。
    assert "<html" in html.lower()


def test_docling_converter_rejects_invalid_pdf_bytes():
    converter = DoclingPDFConverter()

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"not a real pdf content at all")
