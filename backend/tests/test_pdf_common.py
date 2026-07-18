from io import BytesIO

from pypdf import PdfReader

from app.services.pdf_common import first_page_only
from tests._pdf_test_helpers import build_multi_page_pdf as _build_multi_page_pdf

# ADR-014: first_page_onlyはdocling_client/pdf2htmlex_clientの両方から呼ばれる共通の前処理。
# 従来はtest_docling_client.py側にのみ多ページ切り詰め・不正PDFフォールバックの検証があり、
# test_pdf2htmlex_client.py側にはフォールバックの検証が無い非対称な状態だった。ロジック自体は
# pdf_common.pyに一本化されているため、ここで純粋関数として直接・網羅的に検証する。


def _page_widths(content: bytes) -> list:
    reader = PdfReader(BytesIO(content))
    return [float(page.mediabox.width) for page in reader.pages]


def test_first_page_only_truncates_multi_page_pdf_to_first_page():
    multi_page_pdf = _build_multi_page_pdf([200, 300, 400])

    result = first_page_only(multi_page_pdf)

    assert _page_widths(result) == [200.0]


def test_first_page_only_passes_through_content_unchanged_for_single_page_pdf():
    single_page_pdf = _build_multi_page_pdf([200])

    result = first_page_only(single_page_pdf)

    assert result == single_page_pdf


def test_first_page_only_falls_back_to_original_bytes_when_not_a_valid_pdf():
    invalid_content = b"not a real pdf content at all"

    result = first_page_only(invalid_content)

    assert result == invalid_content
