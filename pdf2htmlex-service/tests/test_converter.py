from pathlib import Path

import pytest

from app.converter import PDFConversionError, Pdf2htmlEXConverter

# ADR-023: pdf2htmlEXはPDFの見た目（座標・罫線・フォント）を保持したHTMLを生成する担当。
# テキスト抽出はdocling-service側の責務のため、ここでは「見た目を持つ単一HTMLが返ること」を検証する。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"


def test_converter_generates_self_contained_html_from_real_pdf():
    converter = Pdf2htmlEXConverter()
    html = converter.convert_to_html("sample.pdf", SAMPLE_PDF.read_bytes())

    assert isinstance(html, str)
    assert "<html" in html.lower()
    assert "Docling verification sample text" in html
    # CSS・フォント・画像を埋め込んだ単一HTMLとして返す（外部ファイル参照を残さない）。
    assert 'rel="stylesheet"' not in html
    assert "<style" in html.lower()


def test_converter_rejects_invalid_pdf_bytes():
    converter = Pdf2htmlEXConverter()

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"not a real pdf content at all")
