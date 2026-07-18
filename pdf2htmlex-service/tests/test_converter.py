from pathlib import Path

import pytest

from app.converter import PDFConversionError, Pdf2HtmlExConverter

# ADR-016: pdf2htmlEXは単独のHTMLエンジンとして、フォント・画像・CSSを埋め込んだ
# 自己完結HTMLを生成する。docling-serviceと同じsample.pdf（既知の埋め込みテキストを含む）を使い回す。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"


def test_pdf2htmlex_converter_extracts_html_from_real_pdf():
    converter = Pdf2HtmlExConverter()
    html = converter.convert_to_html("sample.pdf", SAMPLE_PDF.read_bytes())

    assert isinstance(html, str)
    assert "<html" in html.lower()
    assert "Docling verification sample text" in html


def test_pdf2htmlex_converter_rejects_invalid_pdf_bytes():
    converter = Pdf2HtmlExConverter()

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"not a real pdf content at all")
