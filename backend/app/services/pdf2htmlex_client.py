"""pdf2htmlEXによるレイアウトHTML生成の呼び出しレイヤー（ADR-023）。

pdf2htmlEXはPoppler/FontForgeに依存するC++バイナリのためpipで導入できず、専用イメージの
pdf2htmlex-serviceコンテナへHTTPで委譲する（docling_client.pyと同じ構成）。
"""

from __future__ import annotations

import os
from typing import Optional, Protocol

import httpx

from app.services.pdf_common import PDFConversionError, first_page_only

__all__ = [
    "PDFConversionError",
    "PDFLayoutConverter",
    "RemotePdf2htmlEXConverter",
    "get_layout_converter",
]


class PDFLayoutConverter(Protocol):
    """本番/テストで差し替え可能にするための共通インターフェース。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


_DEFAULT_PDF2HTMLEX_SERVICE_URL = "http://pdf2htmlex:8200"


class RemotePdf2htmlEXConverter:
    """pdf2htmlex-serviceへHTTPでレイアウトHTML生成を委譲する本番実装（ADR-023）。"""

    def __init__(
        self, base_url: Optional[str] = None, client: Optional[httpx.Client] = None
    ) -> None:
        self._base_url = (
            base_url or os.environ.get("PDF2HTMLEX_SERVICE_URL", _DEFAULT_PDF2HTMLEX_SERVICE_URL)
        ).rstrip("/")
        self._client = client or httpx.Client()

    def convert_to_html(self, filename: str, content: bytes) -> str:
        try:
            # pdf2htmlEXはMLモデルを持たず1ページなら数秒で終わるが、Apple Silicon上は
            # エミュレーション実行で遅くなるため余裕を持たせる。
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
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text


def get_layout_converter() -> PDFLayoutConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return RemotePdf2htmlEXConverter()
