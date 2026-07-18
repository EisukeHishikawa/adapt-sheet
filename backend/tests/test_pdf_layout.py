import re
from pathlib import Path

import pytest

from app.services.pdf_layout import (
    _MAX_FONT_PX_TITLE,
    PDFConversionError,
    PyMuPDFLayoutConverter,
    _capped_font_size,
    _is_bold,
    _rgb,
    get_layout_converter,
)

# ADR-015: PDFの1ページ目を、テキスト・罫線・背景を絶対座標のdivへ写した1枚のHTMLへ変換する。
# text-element/border-element/bg-elementの3種のdivと、PDFのページサイズを持つコンテナを出力する。
LAYOUT_PDF = Path(__file__).resolve().parent / "fixtures" / "layout_sample.pdf"


def test_converter_generates_layout_html_from_real_pdf():
    converter = PyMuPDFLayoutConverter()
    html = converter.convert_to_html("layout_sample.pdf", LAYOUT_PDF.read_bytes())

    assert "<html" in html.lower()
    # PDFのページサイズ（400x300pt）を持つコンテナを絶対座標配置の基準にする。
    assert "width:400.0px" in html.replace(" ", "")
    assert "height:300.0px" in html.replace(" ", "")
    # テキスト・枠線・背景それぞれのdivが生成されること。
    assert 'class="text-element"' in html
    assert 'class="border-element"' in html
    assert 'class="bg-element"' in html


def test_converter_keeps_text_content_and_escapes_html():
    converter = PyMuPDFLayoutConverter()
    html = converter.convert_to_html("layout_sample.pdf", LAYOUT_PDF.read_bytes())

    assert "Layout Fixture Title" in html
    assert "Amount" in html
    # LLMが読めないバイナリ資産（base64のフォント・画像）は含めない（Gemini向けの設計）。
    assert "base64" not in html
    assert "<script" not in html.lower()


def test_converter_positions_elements_with_absolute_coordinates():
    converter = PyMuPDFLayoutConverter()
    html = converter.convert_to_html("layout_sample.pdf", LAYOUT_PDF.read_bytes())

    # 各要素がPDF由来のleft/topを持つこと（座標の忠実な再現）。
    assert "left:" in html
    assert "top:" in html


def test_converter_rejects_invalid_pdf_bytes():
    converter = PyMuPDFLayoutConverter()

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"not a real pdf content at all")


def test_get_layout_converter_returns_pymupdf_converter():
    assert isinstance(get_layout_converter(), PyMuPDFLayoutConverter)


@pytest.mark.parametrize(
    "font_name, expected",
    [
        ("HiraginoSans-W6", False),
        ("Helvetica-Bold", True),
        ("NotoSansJP-Black", True),
        ("MS-Gothic", True),
        ("Helvetica", False),
    ],
)
def test_is_bold_detects_weight_markers_in_font_name(font_name, expected):
    assert _is_bold(font_name) is expected


@pytest.mark.parametrize(
    "color, expected",
    [
        ((0, 0, 0), "#000000"),
        ((1, 1, 1), "#ffffff"),
        ((1, 0, 0), "#ff0000"),
        ((0.2, 0.4, 0.6), "#336699"),
    ],
)
def test_rgb_converts_unit_tuple_to_css_hex(color, expected):
    assert _rgb(color) == expected


@pytest.mark.parametrize(
    "size, expected",
    [
        (40.0, 22.0),   # 過大なタイトルは22pxへ頭打ち
        (18.5, 18.5),   # 上限以下のタイトルはそのまま（実請求書の帳票名）
        (16.0, 16.0),   # タイトル帯で上限以下はそのまま
        (14.5, 14.0),   # 見出し帯（12〜15pt）で上限超過は14pxへ
        (13.0, 13.0),   # 見出し帯で上限以下はそのまま
        (11.5, 11.0),   # 本文帯（12pt未満）で上限超過は11pxへ
        (8.0, 8.0),     # 元が小さい本文は縮めない（実請求書の本文）
    ],
)
def test_capped_font_size_limits_by_area(size, expected):
    assert _capped_font_size(size) == expected


def test_converter_caps_font_sizes_below_title_max():
    # 生成HTMLのfont-sizeが役割別上限（最大でもタイトル上限）を超えないこと。
    converter = PyMuPDFLayoutConverter()
    html = converter.convert_to_html("layout_sample.pdf", LAYOUT_PDF.read_bytes())

    sizes = [float(m) for m in re.findall(r"font-size:([\d.]+)px", html)]
    assert sizes  # フォント指定が存在する
    assert max(sizes) <= _MAX_FONT_PX_TITLE
