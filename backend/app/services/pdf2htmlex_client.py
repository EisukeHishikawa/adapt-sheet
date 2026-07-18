"""pdf2htmlEXによるPDF→HTML変換の呼び出しレイヤー（ADR-016）。

pdf2htmlEXバイナリ（AGPL、特殊パッチ済みpoppler/libfontforgeに依存する重量級ネイティブ依存）は
docling-service同様、専用コンテナ（pdf2htmlex-service）へ分離している。本モジュールはHTTP経由で
`POST /convert`を呼び出すクライアントのみを持つ。
"""

from __future__ import annotations

import os
from typing import Optional, Protocol

import httpx

from app.services.pdf_common import PDFConversionError, first_page_only

__all__ = [
    "PDFConversionError",
    "PDFHtmlExtractor",
    "RemotePdf2HtmlExExtractor",
    "get_pdf2htmlex_extractor",
]


class PDFHtmlExtractor(Protocol):
    """本番/テストで差し替え可能にするための共通インターフェース（docling_clientと同じ形）。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


# 未設定時の既定をcompose上のサービス名に合わせ、環境変数を明示しない単体実行でも動くようにする。
_DEFAULT_PDF2HTMLEX_SERVICE_URL = "http://pdf2htmlex:8200"


class RemotePdf2HtmlExExtractor:
    """pdf2htmlex-serviceへHTTPで変換を委譲する本番実装（ADR-016）。"""

    def __init__(
        self, base_url: Optional[str] = None, client: Optional[httpx.Client] = None
    ) -> None:
        # テスト側がhttpx.MockTransportを注入したClientやカスタムURLへ差し替えられるよう引数で受ける。
        self._base_url = (
            base_url or os.environ.get("PDF2HTMLEX_SERVICE_URL", _DEFAULT_PDF2HTMLEX_SERVICE_URL)
        ).rstrip("/")
        self._client = client or httpx.Client()

    def convert_to_html(self, filename: str, content: bytes) -> str:
        try:
            response = self._client.post(
                f"{self._base_url}/convert",
                files={"file": (filename, first_page_only(content), "application/pdf")},
                timeout=120.0,
            )
        except httpx.RequestError as exc:
            raise PDFConversionError(f"pdf2htmlex-serviceへの接続に失敗しました: {exc}") from exc

        if response.status_code != 200:
            raise PDFConversionError(
                f"PDFの解析に失敗しました（pdf2htmlex-service status={response.status_code}）: "
                f"{_extract_detail(response)}"
            )

        return response.json()["html"]


def _extract_detail(response: httpx.Response) -> str:
    # pdf2htmlex-serviceはFastAPIのHTTPExceptionで{"detail": ...}を返すが、想定外の形式
    # が返っても落ちないようフォールバックする（docling_clientと同じ方針）。
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text


def get_pdf2htmlex_extractor() -> PDFHtmlExtractor:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return RemotePdf2HtmlExExtractor()
