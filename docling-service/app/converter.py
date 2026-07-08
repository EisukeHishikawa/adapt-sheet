"""Docling によるPDF→HTML変換レイヤー（DEVELOPMENT.md ステップ7→ステップ15でdocling-serviceへ分離）。

ADR-003に基づきDoclingを既存PDF解析エンジンとして採用する。ADR-018に基づき、
本モジュールはbackend/app/services/docling_client.pyから移動したもので、実装ロジック自体は
変更していない。分離後はbackend側からHTTP経由（app/main.pyのPOST /convert）で呼び出される。
"""

from __future__ import annotations

import io
from typing import Protocol

from docling.datamodel.base_models import ConversionStatus
from docling.document_converter import DocumentConverter
from docling.exceptions import ConversionError
from docling_core.types.io import DocumentStream


class PDFConversionError(Exception):
    """PDF解析に失敗した場合の例外。

    呼び出し側（app/main.py）で422 Unprocessable Entityへ変換することを想定する。
    """


class PDFConverter(Protocol):
    """テスト側がdependency_overridesで高速なフェイクに差し替えられるようにするための共通インターフェース。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


class DoclingPDFConverter:
    """docling.DocumentConverterを用いた本番実装。"""

    def __init__(self) -> None:
        # モデルのロード自体はDocumentConverter初期化時ではなく初回convert時に行われるため、
        # ここでは軽量なインスタンス生成のみ行う。
        self._converter = DocumentConverter()

    def convert_to_html(self, filename: str, content: bytes) -> str:
        # ディスクへの一時ファイル書き出しを避けるため、DocumentStreamでメモリ上のbytesを直接渡す。
        stream = DocumentStream(name=filename, stream=io.BytesIO(content))

        try:
            result = self._converter.convert(stream)
        except ConversionError as exc:
            # 破損PDF・パスワード保護PDF等はここで例外化される。
            raise PDFConversionError(f"PDFの解析に失敗しました: {exc}") from exc

        if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
            raise PDFConversionError(f"PDFの解析に失敗しました（status={result.status.value}）")

        return result.document.export_to_html()


def get_pdf_converter() -> PDFConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return DoclingPDFConverter()
