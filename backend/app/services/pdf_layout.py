"""PyMuPDF（fitz）によるレイアウトHTML生成（ADR-015）。

PDFの1ページ目を、テキスト・罫線・背景色を絶対座標のdivへ写した1枚のHTMLに変換する。
出力の唯一の宛先はGeminiのプロンプトであり、Geminiがこれを「見た目の正」として読み、
保守しやすいHTML/CSSへ作り替える（テキストの正はDocling由来のMarkdown。ADR-015の役割分担を踏襲）。
"""

from __future__ import annotations

from html import escape
from typing import Protocol

import fitz

from app.services.pdf_common import PDFConversionError

__all__ = [
    "PDFConversionError",
    "PDFLayoutConverter",
    "PyMuPDFLayoutConverter",
    "get_layout_converter",
]

# フォント名にこれらを含むスパンを太字とみなす。PDFは太字を別フォント（例: "...-Bold"）として
# 埋め込むことが多く、CSSのfont-weightへ直接は写らないため名前から推定する。
_BOLD_FONT_MARKERS = ("bold", "black", "heavy", "gothic")
# サーバー環境にPDF埋め込みフォントが無くても字形が崩れないよう、Webフォントを最優先に指定する。
_FONT_STACK = "'Noto Sans JP', sans-serif"

# 一般的な請求書・帳票として過大にならないフォントサイズ上限（px）。役割（エリア）別に分ける（ADR-015）。
# PDFが大きめの字で作られていてもここで頭打ちにする。上限を超えない元の小さい字は縮めない（min）。
# GeminiはこのHTMLを見た目の参照にするため、入力段階で過大なサイズを抑えると出力も過大になりにくい。
_MAX_FONT_PX_TITLE = 22.0    # 帳票名・大見出し
_MAX_FONT_PX_HEADING = 14.0  # セクション見出し・ラベル
_MAX_FONT_PX_BODY = 11.0     # 明細・本文・その他
# 元のフォントサイズ（pt）から役割を推定する境界。これ以上を各ティアとみなす。
_FONT_TIER_TITLE_MIN = 15.0
_FONT_TIER_HEADING_MIN = 12.0


class PDFLayoutConverter(Protocol):
    """本番/テストで差し替え可能にするための共通インターフェース（ai_client.AIClientと同じ方針）。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


class PyMuPDFLayoutConverter:
    """PDFの1ページ目をレイアウト保持HTMLへ変換するbackend内実装（ADR-015）。"""

    def convert_to_html(self, filename: str, content: bytes) -> str:
        try:
            doc = fitz.open(stream=content, filetype="pdf")
        except Exception as exc:
            raise PDFConversionError(f"PDFの解析に失敗しました: {exc}") from exc

        try:
            if doc.page_count == 0:
                raise PDFConversionError("PDFにページがありません")
            # 帳票テンプレートは1ページ完結が前提（ADR-015）。
            return _render_page(doc[0])
        finally:
            doc.close()


def _render_page(page: "fitz.Page") -> str:
    width = page.rect.width
    height = page.rect.height

    parts = [_document_head(width, height)]
    parts.extend(_shape_divs(page))
    parts.extend(_text_divs(page))
    parts.append("    </div>\n</body>\n</html>\n")
    return "".join(parts)


def _shape_divs(page: "fitz.Page") -> list:
    """罫線・枠線（stroke）と背景の塗り（fill）を絶対配置のdivへ写す。"""
    divs = []
    for draw in page.get_drawings():
        if draw["type"] == "f":
            fill = draw.get("fill")
            if fill is None:
                continue
            rect = draw["rect"]
            w, h = rect.x1 - rect.x0, rect.y1 - rect.y0
            # 1px以下の塗りは字の影やアンチエイリアス由来のノイズが多いため落とす。
            if w > 1 and h > 1:
                divs.append(
                    f'        <div class="bg-element" style="left:{rect.x0:.1f}px;'
                    f' top:{rect.y0:.1f}px; width:{w:.1f}px; height:{h:.1f}px;'
                    f' background-color:{_rgb(fill)};"></div>\n'
                )
        elif draw["type"] == "s":
            color = _rgb(draw["color"]) if draw.get("color") else "#000000"
            for rect in draw.get("rects", [draw["rect"]]):
                w, h = rect.x1 - rect.x0, rect.y1 - rect.y0
                if w > 0 or h > 0:
                    divs.append(
                        f'        <div class="border-element" style="left:{rect.x0:.1f}px;'
                        f' top:{rect.y0:.1f}px; width:{w:.1f}px; height:{h:.1f}px;'
                        f' border-color:{color};"></div>\n'
                    )
    return divs


def _text_divs(page: "fitz.Page") -> list:
    """テキストを、フォントサイズ・色・太字を保持したまま絶対配置のdivへ写す。"""
    divs = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                text = span["text"].strip()
                if not text:
                    continue
                x0, y0, x1, _ = span["bbox"]
                size = round(_capped_font_size(span["size"]), 1)
                color = f"#{span['color']:06x}"
                weight = "bold" if _is_bold(span["font"]) else "normal"
                divs.append(
                    f'        <div class="text-element" style="left:{x0:.1f}px;'
                    f' top:{y0:.1f}px; font-size:{size}px; color:{color};'
                    f' font-weight:{weight};">{escape(text)}</div>\n'
                )
    return divs


def _is_bold(font_name: str) -> bool:
    lowered = font_name.lower()
    return any(marker in lowered for marker in _BOLD_FONT_MARKERS)


def _capped_font_size(size: float) -> float:
    """フォントサイズを役割別の上限で頭打ちにする（ADR-015）。

    元のサイズから役割（タイトル/見出し/明細・本文）を推定し、その上限を超える分だけ縮める。
    元が上限以下ならそのまま返す（小さい字は縮めない）。明細と本文・その他は同じ本文サイズ帯として
    1つの上限にまとめる（フォントサイズだけでは明細とその他を区別できないため）。
    """
    if size >= _FONT_TIER_TITLE_MIN:
        return min(size, _MAX_FONT_PX_TITLE)
    if size >= _FONT_TIER_HEADING_MIN:
        return min(size, _MAX_FONT_PX_HEADING)
    return min(size, _MAX_FONT_PX_BODY)


def _rgb(color: tuple) -> str:
    """PyMuPDFの0〜1のRGBタプルをCSSの#rrggbbへ変換する。"""
    r, g, b = (int(round(channel * 255)) for channel in color[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def _document_head(width: float, height: float) -> str:
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>自動生成テンプレート</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after {{ box-sizing: border-box; }}
        body {{ margin: 0; padding: 20px; background-color: #f1f5f9; display: flex; justify-content: center; }}
        .page-container {{
            position: relative;
            width: {width:.1f}px;
            height: {height:.1f}px;
            background-color: #ffffff;
            overflow: hidden;
            font-family: {_FONT_STACK};
        }}
        .bg-element {{ position: absolute; z-index: 1; }}
        .border-element {{ position: absolute; border: 1px solid; z-index: 2; }}
        .text-element {{ position: absolute; white-space: nowrap; line-height: 1.0; z-index: 3; }}
    </style>
</head>
<body>
    <div class="page-container">
"""


def get_layout_converter() -> PDFLayoutConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return PyMuPDFLayoutConverter()
