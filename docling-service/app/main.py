"""Doclingによるテキスト抽出専用の内部サービス（ADR-013/016）。

Docker Compose内部ネットワーク経由でbackendからのみ呼ばれ、ホストへは公開しないため、
CORS設定や認証は行わない。
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile

from app.converter import PDFConversionError, PDFConverter, get_pdf_converter

app = FastAPI()


@app.post("/convert")
def convert(
    file: UploadFile = File(...),
    # Dependsで注入し、テスト側が変換の成功/失敗を高速なフェイクへ差し替えられるようにする（ADR-006）。
    pdf_converter: PDFConverter = Depends(get_pdf_converter),
) -> dict:
    try:
        html = pdf_converter.convert_to_html(file.filename or "uploaded.pdf", file.file.read())
    except PDFConversionError as exc:
        # backend側のRemoteDoclingHtmlExtractorがこの422を検知し、自身のPDFConversionErrorへ
        # 再マッピングする（ADR-012により最終的に422レスポンスになる）。
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"html": html}
