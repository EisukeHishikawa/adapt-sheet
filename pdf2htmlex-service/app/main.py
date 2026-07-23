"""pdf2htmlEXによるPDF→HTML変換専用の内部サービス（ADR-015）。

Docker Compose内部ネットワーク経由でbackendからのみ呼ばれ、ホストへは公開しないため、
CORS設定や認証は行わない（docling-serviceと同じ設計方針）。
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile

from app.converter import PDFConversionError, PDFConverter, get_pdf_converter
from app.logging_config import RequestContextMiddleware, configure_logging

# アプリ生成前に設定し、起動〜リクエスト処理まで一貫してJSON構造化ログにする（ADR-011/030）。
configure_logging()

app = FastAPI()

# backendから渡された相関ID（X-Request-ID）でアクセスログを出す（ADR-030）。
app.add_middleware(RequestContextMiddleware)


@app.get("/health")
def health() -> dict:
    """backendのウォームアップ用の軽量エンドポイント（ADR-028）。

    Lambda実行環境を起こすことだけが目的のため、PDF変換の依存には一切触れない。
    """
    return {"status": "ok"}


@app.post("/convert")
def convert(
    file: UploadFile = File(...),
    # Dependsで注入し、テスト側が変換の成功/失敗を高速なフェイクへ差し替えられるようにする（ADR-006）。
    pdf_converter: PDFConverter = Depends(get_pdf_converter),
) -> dict:
    try:
        html = pdf_converter.convert_to_html(file.filename or "uploaded.pdf", file.file.read())
    except PDFConversionError as exc:
        # backend側のRemotePdf2HtmlExExtractorがこの422を検知し、自身のPDFConversionErrorへ
        # 再マッピングする（ADR-012により最終的に422レスポンスになる）。
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"html": html}
