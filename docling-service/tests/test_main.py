from pathlib import Path

from fastapi.testclient import TestClient

from app.converter import PDFConversionError, get_pdf_converter
from app.main import app

# 内部契約（ADR-014/016）: POST /convert に file を送ると {"html": ...} が返る。
# 実際のDocling変換の正しさはtest_converter.pyで検証済みのため、ここではDIをフェイクに
# 差し替えてHTTPレイヤーの配線（成功時200/失敗時422）のみを検証する。
SAMPLE_PDF = Path(__file__).resolve().parent / "fixtures" / "sample.pdf"

client = TestClient(app)


def test_convert_returns_html_on_success():
    class _FakeConverter:
        def convert_to_html(self, filename: str, content: bytes) -> str:
            return "<html><body>converted-html-marker</body></html>"

    app.dependency_overrides[get_pdf_converter] = lambda: _FakeConverter()
    try:
        response = client.post(
            "/convert",
            files={"file": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
        )
        assert response.status_code == 200
        assert response.json() == {"html": "<html><body>converted-html-marker</body></html>"}
    finally:
        app.dependency_overrides.pop(get_pdf_converter, None)


def test_convert_returns_422_when_conversion_fails():
    class _FailingConverter:
        def convert_to_html(self, filename: str, content: bytes) -> str:
            raise PDFConversionError("PDFの解析に失敗しました（テスト用）")

    app.dependency_overrides[get_pdf_converter] = lambda: _FailingConverter()
    try:
        response = client.post(
            "/convert",
            files={"file": ("broken.pdf", b"not a real pdf", "application/pdf")},
        )
        assert response.status_code == 422
        assert "PDFの解析に失敗しました" in response.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_pdf_converter, None)


def test_convert_end_to_end_with_real_docling():
    # DIをフェイクに差し替えず、実際のDoclingConverterを通す結合確認。
    response = client.post(
        "/convert",
        files={"file": ("sample.pdf", SAMPLE_PDF.read_bytes(), "application/pdf")},
    )
    assert response.status_code == 200
    assert "Docling verification sample text" in response.json()["html"]
