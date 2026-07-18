"""DoclingによるPDF→HTMLテキスト抽出レイヤー（ADR-003/014/016）。

ADR-016により、DoclingはMarkdownではなくHTMLを返す。Docling/pdf2htmlEX/PyMuPDFの3エンジンは
AIを介さない単独の変換結果として直接プレビューされるため、出力形式をHTMLに揃えている。
"""

from __future__ import annotations

import io
from typing import Protocol

from docling.datamodel.base_models import ConversionStatus
from docling.document_converter import DocumentConverter
from docling.exceptions import ConversionError
from docling_core.types.io import DocumentStream


class PDFConversionError(Exception):
    """PDF解析の失敗。app/main.pyで422 Unprocessable Entityへ変換する。"""


class PDFConverter(Protocol):
    """テスト側がdependency_overridesで高速なフェイクへ差し替えるための共通インターフェース。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


class DoclingPDFConverter:
    def __init__(self, converter: object = None) -> None:
        # モデルのロードは初回convert時に行われるため、ここは軽量なインスタンス生成のみ。
        # converterはテスト側がDocumentConverter.convertの戻り値（status等）をフェイクへ
        # 差し替えられるようにするための注入口（ai_client.py等と同じDI方針）。
        self._converter = converter or DocumentConverter()

    def convert_to_html(self, filename: str, content: bytes) -> str:
        # ディスクへの一時ファイル書き出しを避け、メモリ上のbytesを直接渡す。
        stream = DocumentStream(name=filename, stream=io.BytesIO(content))

        try:
            result = self._converter.convert(stream)
        except ConversionError as exc:
            # 破損PDF・パスワード保護PDF等。
            raise PDFConversionError(f"PDFの解析に失敗しました: {exc}") from exc

        if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
            raise PDFConversionError(f"PDFの解析に失敗しました（status={result.status.value}）")

        return result.document.export_to_html()


def get_pdf_converter() -> PDFConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return DoclingPDFConverter()
