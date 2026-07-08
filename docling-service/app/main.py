"""Docling変換専用の内部サービス（DEVELOPMENT.md ステップ15、ADR-018）。

backendコンテナから見た内部エンドポイントのみを公開する薄いFastAPIアプリ。
ホストへは公開せずDocker Compose内部ネットワーク（サービス名`docling`）経由でのみ
呼び出される想定のため、CORS設定や認証は行わない。
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile

from app.converter import PDFConversionError, PDFConverter, get_pdf_converter

app = FastAPI()


@app.post("/convert")
def convert(
    file: UploadFile = File(...),
    # FastAPIのDependsで注入することで、テスト側がdependency_overridesにより
    # 変換の成功/失敗を高速なフェイクに差し替えられるようにする（backend側と同じ方針、ADR-007）。
    pdf_converter: PDFConverter = Depends(get_pdf_converter),
) -> dict:
    try:
        html = pdf_converter.convert_to_html(file.filename or "uploaded.pdf", file.file.read())
    except PDFConversionError as exc:
        # backend側のRemoteDoclingPDFConverterがこの422を検知し、既存のPDFConversionError
        # （ADR-017により422レスポンスへ整形される）へ再マッピングする。
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"html": html}
