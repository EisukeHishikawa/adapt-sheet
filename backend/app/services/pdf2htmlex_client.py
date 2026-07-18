"""pdf2htmlEXによるPDF→HTML変換の呼び出しレイヤー（ADR-015）。

pdf2htmlEXバイナリ（AGPL、特殊パッチ済みpoppler/libfontforgeに依存する重量級ネイティブ依存）は
docling-service同様、専用コンテナ（pdf2htmlex-service）へ分離している。本モジュールはHTTP経由で
`POST /convert`を呼び出すクライアントのみを持ち、HTTP委譲の共通処理はRemoteHtmlExtractor
（remote_extractor.py）が担う。ここではpdf2htmlEX固有の接続先だけを定義する。
"""

from __future__ import annotations

from app.services.pdf_common import PDFConversionError
from app.services.remote_extractor import PDFHtmlExtractor, RemoteHtmlExtractor

__all__ = [
    "PDFConversionError",
    "PDFHtmlExtractor",
    "RemotePdf2HtmlExExtractor",
    "get_pdf2htmlex_extractor",
]


class RemotePdf2HtmlExExtractor(RemoteHtmlExtractor):
    """pdf2htmlex-serviceへHTTPで変換を委譲する本番実装（ADR-015）。"""

    _service_label = "pdf2htmlex-service"
    _env_var = "PDF2HTMLEX_SERVICE_URL"
    # 未設定時の既定をcompose上のサービス名に合わせ、環境変数を明示しない単体実行でも動くようにする。
    _default_url = "http://pdf2htmlex:8200"


def get_pdf2htmlex_extractor() -> PDFHtmlExtractor:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return RemotePdf2HtmlExExtractor()
