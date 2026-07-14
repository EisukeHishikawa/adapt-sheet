from pathlib import Path

import pytest

from app.converter import PDFConversionError, Pdf2htmlEXConverter, _inline_svg_backgrounds

# ADR-023: pdf2htmlEXはPDFの見た目（座標・罫線・フォント）を保持したHTMLを生成する担当。
# 出力の唯一の宛先はGeminiのプロンプトであるため、LLMが読めないバイナリ資産
# （base64のフォント・画像）やboilerplateのJSは含めず、レイアウトを表すCSSのみを埋め込む。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"
# 枠線・横罫線・縦罫線を持つPDF。テキストしか含まないsample.pdfでは罫線の再現を検証できない。
RULED_PDF = Path(__file__).resolve().parent / "fixtures" / "ruled.pdf"


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


def test_converter_keeps_ruling_lines_as_inline_svg():
    # 罫線・枠線はテキストではなく背景の図形として描かれる。DoclingのMarkdownは罫線を表現
    # できないため、pdf2htmlEX側がベクター（SVGのpath）で見た目の正を渡す（ADR-023）。
    converter = Pdf2htmlEXConverter()
    html = converter.convert_to_html("ruled.pdf", RULED_PDF.read_bytes())

    # 外部ファイル参照（<img src="bg1.svg">）ではHTML1枚では解決できないため、インライン展開する。
    assert "<svg" in html
    assert "<path" in html
    assert "bg1.svg" not in html
    # ベクターのまま渡すこと（ラスタライズされた背景画像はLLMが読めない）。
    assert "base64" not in html


def test_inline_svg_backgrounds_drops_bitmaps_inside_svg():
    # SVG内に残るビットマップ（ロゴ等のdata URI）はLLMが読めずトークンだけ消費するため落とす。
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
        '<image id="i1" xlink:href="data:image/png;base64,AAAA"/>'
        '<path d="M 0 0 L 10 0"/>'
        "</svg>"
    )
    html = '<div><img class="bf" alt="" src="bg1.svg"/></div>'

    result = _inline_svg_backgrounds(html, {"bg1.svg": svg})

    assert "<path" in result
    assert "base64" not in result
    assert "<image" not in result
    assert "<img" not in result
    # 背景を配置していた<img>のクラスを<svg>が引き継ぐこと（罫線の位置がページとずれないため）。
    assert 'class="bf"' in result
