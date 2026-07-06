"""Docling によるPDF→HTML変換レイヤー（DEVELOPMENT.md ステップ7）。

ADR-003に基づきDoclingを既存PDF解析エンジンとして採用する。docs/architecture.md 2節の
シーケンス図の通り、/api/render にPDFが送信された場合のみここでベースHTMLを抽出し、
Claudeへのプロンプト構築のコンテキストとして利用する（app/main.py参照）。
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

    docs/spec.mdのエラーコード定義に合わせ、呼び出し側（app/main.py）で
    422 Unprocessable Entityへ変換することを想定する。
    """


class PDFConverter(Protocol):
    """本番/テストで差し替え可能にするための共通インターフェース。

    ai_client.AIClientと同様、FastAPIのDependsで注入し、
    テスト側がdependency_overridesで高速なフェイクに差し替えられるようにする。
    """

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
            # 破損PDF・パスワード保護PDF等はここで例外化される（docs/spec.md 422の発生条件）。
            raise PDFConversionError(f"PDFの解析に失敗しました: {exc}") from exc

        if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
            raise PDFConversionError(f"PDFの解析に失敗しました（status={result.status.value}）")

        return result.document.export_to_html()


def get_pdf_converter() -> PDFConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return DoclingPDFConverter()
