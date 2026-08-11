"""DoclingによるPDF→HTMLテキスト抽出レイヤー。

変換結果はAIを介さずそのままプレビューされるため、出力形式を他の変換エンジンとHTMLで揃える。
"""

from __future__ import annotations

import io
from typing import Optional, Protocol

from docling.datamodel.base_models import ConversionStatus, InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.exceptions import ConversionError
from docling_core.types.io import DocumentStream

# OCR・表構造認識はLambdaのCPUでは合計40秒超（実測）かかりタイムアウトするため無効化する。
# ほとんどのPDFは埋め込みテキストを持ちOCR不要で、表も罫線を含むレイアウトとしては残る。
_PDF_FORMAT_OPTION = PdfFormatOption(pipeline_options=PdfPipelineOptions(do_ocr=False, do_table_structure=False))


class PDFConversionError(Exception):
    """PDF解析の失敗。app/main.pyで422 Unprocessable Entityへ変換する。"""


class PDFConverter(Protocol):
    """テスト側がdependency_overridesで高速なフェイクへ差し替えるための共通インターフェース。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


class DoclingPDFConverter:
    def __init__(self, converter: object = None) -> None:
        # converterはテストがフェイクへ差し替えるための注入口。
        self._converter = converter or DocumentConverter(format_options={InputFormat.PDF: _PDF_FORMAT_OPTION})

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


_converter: Optional[DoclingPDFConverter] = None


def get_pdf_converter() -> PDFConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。

    DocumentConverterはOCR/レイアウト/表構造のモデルパイプラインを初回convert時に構築し、
    そのコストは数秒〜十数秒かかる。リクエストごとに新規生成すると温まったLambda実行環境上でも
    毎回このコストを払うことになり、API Gatewayの統合タイムアウト（29秒）に収まらなくなるため、
    モジュールスコープで1つだけ生成してプロセス内で使い回す。
    """
    global _converter
    if _converter is None:
        _converter = DoclingPDFConverter()
    return _converter
