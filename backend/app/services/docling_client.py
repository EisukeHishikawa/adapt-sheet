"""Doclingによるテキスト抽出（HTML）の呼び出しレイヤー（ADR-014/016）。

Docling本体（torch等の大容量ML依存）はdocling-serviceコンテナへ分離しているため、本モジュールは
HTTP経由で`POST /convert`を呼び出すクライアントのみを持つ。ADR-016により、Doclingは
Markdownではなく単独のHTMLエンジンとして選択可能になった（AIを介さず変換結果をそのまま描画する）。
"""

from __future__ import annotations

import os
from typing import Optional, Protocol

import httpx

from app.services.pdf_common import PDFConversionError, first_page_only

__all__ = [
    "PDFConversionError",
    "PDFHtmlExtractor",
    "RemoteDoclingHtmlExtractor",
    "get_html_extractor",
]


class PDFHtmlExtractor(Protocol):
    """本番/テストで差し替え可能にするための共通インターフェース（ai_client.AIClientと同じ方針）。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


# 未設定時の既定をcompose上のサービス名に合わせ、環境変数を明示しない単体実行でも動くようにする。
_DEFAULT_DOCLING_SERVICE_URL = "http://docling:8100"


class RemoteDoclingHtmlExtractor:
    """docling-serviceへHTTPでテキスト抽出を委譲する本番実装（ADR-014/016）。"""

    def __init__(
        self, base_url: Optional[str] = None, client: Optional[httpx.Client] = None
    ) -> None:
        # テスト側がhttpx.MockTransportを注入したClientやカスタムURLへ差し替えられるよう引数で受ける。
        self._base_url = (
            base_url or os.environ.get("DOCLING_SERVICE_URL", _DEFAULT_DOCLING_SERVICE_URL)
        ).rstrip("/")
        self._client = client or httpx.Client()

    def convert_to_html(self, filename: str, content: bytes) -> str:
        try:
            # コンテナ起動直後の初回変換ではOCRモデルのダウンロード（実測60秒超）が発生しうるため、
            # 通常の推論時間（数秒〜十数秒）より大きめのタイムアウトを取る。
            response = self._client.post(
                f"{self._base_url}/convert",
                files={"file": (filename, first_page_only(content), "application/pdf")},
                timeout=120.0,
            )
        except httpx.RequestError as exc:
            raise PDFConversionError(f"docling-serviceへの接続に失敗しました: {exc}") from exc

        if response.status_code != 200:
            raise PDFConversionError(
                f"PDFの解析に失敗しました（docling-service status={response.status_code}）: "
                f"{_extract_detail(response)}"
            )

        return response.json()["html"]


def _extract_detail(response: httpx.Response) -> str:
    # docling-serviceはFastAPIのHTTPExceptionで{"detail": ...}を返すが、想定外の形式
    # （ネットワーク機器のエラーページ等）が返っても落ちないようフォールバックする。
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text


def get_html_extractor() -> PDFHtmlExtractor:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return RemoteDoclingHtmlExtractor()
