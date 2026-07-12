from pathlib import Path

import pytest

from app.converter import PDFConversionError, Pdf2htmlEXConverter

# ADR-023: pdf2htmlEXはPDFの見た目（座標・罫線・フォント）を保持したHTMLを生成する担当。
# 出力の唯一の宛先はGeminiのプロンプトであるため、LLMが読めないバイナリ資産
# （base64のフォント・画像）やboilerplateのJSは含めず、レイアウトを表すCSSのみを埋め込む。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"


def test_converter_generates_layout_html_from_real_pdf():
    converter = Pdf2htmlEXConverter()
    html = converter.convert_to_html("sample.pdf", SAMPLE_PDF.read_bytes())

    assert isinstance(html, str)
    assert "<html" in html.lower()
    assert "Docling verification sample text" in html
    # レイアウト情報（絶対座標のCSSクラス定義）が埋め込まれていること。
    assert "<style" in html.lower()
    assert "position:absolute" in html.replace(" ", "")


def test_converter_excludes_payload_that_llm_cannot_read():
    # Gemini 2.5 Flashは入力が大きすぎると503を返すため、LLMが読めない資産を入力から排除する（ADR-023）。
    converter = Pdf2htmlEXConverter()
    html = converter.convert_to_html("sample.pdf", SAMPLE_PDF.read_bytes())

    # 埋め込みフォント・画像（base64のdata URI）とboilerplateのJSを含まないこと。
    assert "base64" not in html
    assert "<script" not in html.lower()
    # 返すのはHTML1枚だけのため、解決できない外部ファイル参照は残さない。
    assert "<link" not in html.lower()


def test_converter_rejects_invalid_pdf_bytes():
    converter = Pdf2htmlEXConverter()

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"not a real pdf content at all")
