from pathlib import Path
from types import SimpleNamespace

import pytest
from docling.datamodel.base_models import ConversionStatus
from docling.exceptions import ConversionError

from app.converter import DoclingPDFConverter, PDFConversionError

# ADR-016: DoclingはHTML変換（テキスト・論理構造の抽出結果をそのままHTMLとして返す）を担う。
# scripts/verify_docling.pyと同じ既知の埋め込みテキストを含むサンプルPDFを使い回す。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"


def test_docling_converter_extracts_html_from_real_pdf():
    converter = DoclingPDFConverter()
    html = converter.convert_to_html("sample.pdf", SAMPLE_PDF.read_bytes())

    assert isinstance(html, str)
    assert "Docling verification sample text" in html
    # ADR-016: 単独のHTMLエンジンとしてそのまま描画結果になるため、html文書として返す。
    assert "<html" in html.lower()


def test_docling_converter_rejects_invalid_pdf_bytes():
    converter = DoclingPDFConverter()

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"not a real pdf content at all")


# 以下、実PDF変換（重い・環境依存）を経由せず、DocumentConverter.convertの戻り値をフェイクへ
# 差し替えて、convert_to_html自身のステータス判定ロジックを検証する。


class _FakeDocumentConverter:
    def __init__(self, result=None, error: Exception = None):
        self._result = result
        self._error = error

    def convert(self, stream):
        if self._error is not None:
            raise self._error
        return self._result


def _fake_result(status: ConversionStatus, html: str = "<html>ok</html>"):
    return SimpleNamespace(status=status, document=SimpleNamespace(export_to_html=lambda: html))


def test_docling_converter_raises_pdf_conversion_error_on_conversion_error():
    # 破損PDF・パスワード保護PDF等、docling自体が例外を送出するケース。
    fake = _FakeDocumentConverter(error=ConversionError("破損PDF（テスト用）"))
    converter = DoclingPDFConverter(converter=fake)

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"dummy")


def test_docling_converter_raises_pdf_conversion_error_on_failure_status():
    # 例外は投げないが、status=FAILUREとして結果が返るケース。
    fake = _FakeDocumentConverter(result=_fake_result(ConversionStatus.FAILURE))
    converter = DoclingPDFConverter(converter=fake)

    with pytest.raises(PDFConversionError):
        converter.convert_to_html("broken.pdf", b"dummy")


def test_docling_converter_accepts_partial_success_status():
    # SUCCESSだけでなくPARTIAL_SUCCESSも解析結果として受け入れ、htmlを返す契約を検証する。
    fake = _FakeDocumentConverter(result=_fake_result(ConversionStatus.PARTIAL_SUCCESS, html="<html>partial</html>"))
    converter = DoclingPDFConverter(converter=fake)

    html = converter.convert_to_html("sample.pdf", b"dummy")

    assert html == "<html>partial</html>"
