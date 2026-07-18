"""内部変換サービス（docling-service / pdf2htmlex-service）へHTTPで委譲する共通実装（ADR-014/016）。

Docling（torch等の大容量ML依存）とpdf2htmlEX（AGPL、特殊パッチ済みpoppler/libfontforgeに依存する
重量級ネイティブ依存）はいずれも専用コンテナへ分離しており、backendからはHTTP経由の`POST /convert`を
呼ぶだけという配線が共通する。サービスごとの違いは「表示名・環境変数名・既定URL」だけのため、
共通部分を本モジュールへ集約し、各クライアント（docling_client / pdf2htmlex_client）は差分のみを持つ。
"""

from __future__ import annotations

import os
from typing import Optional, Protocol

import httpx

from app.services.pdf_common import PDFConversionError, first_page_only


class PDFHtmlExtractor(Protocol):
    """本番/テストで差し替え可能にするための共通インターフェース（ai_client.AIClientと同じ方針）。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


class RemoteHtmlExtractor:
    """変換サービスへHTTPでPDF→HTML変換を委譲する本番実装の基底（ADR-014/016）。

    サブクラスは表示名・環境変数名・既定URLの3つだけを定義する。
    """

    # サブクラスが定義する。_service_labelはエラー文言に載せる人間可読なサービス名。
    _service_label: str
    _env_var: str
    _default_url: str

    def __init__(
        self, base_url: Optional[str] = None, client: Optional[httpx.Client] = None
    ) -> None:
        # テスト側がhttpx.MockTransportを注入したClientやカスタムURLへ差し替えられるよう引数で受ける。
        self._base_url = (
            base_url or os.environ.get(self._env_var, self._default_url)
        ).rstrip("/")
        self._client = client or httpx.Client()

    def convert_to_html(self, filename: str, content: bytes) -> str:
        try:
            # コンテナ起動直後の初回変換ではモデルのダウンロード（Doclingで実測60秒超）が発生しうるため、
            # 通常の推論時間（数秒〜十数秒）より大きめのタイムアウトを取る。
            response = self._client.post(
                f"{self._base_url}/convert",
                files={"file": (filename, first_page_only(content), "application/pdf")},
                timeout=120.0,
            )
        except httpx.RequestError as exc:
            raise PDFConversionError(f"{self._service_label}への接続に失敗しました: {exc}") from exc

        if response.status_code != 200:
            raise PDFConversionError(
                f"PDFの解析に失敗しました（{self._service_label} status={response.status_code}）: "
                f"{_extract_detail(response)}"
            )

        return response.json()["html"]


def _extract_detail(response: httpx.Response) -> str:
    # 各サービスはFastAPIのHTTPExceptionで{"detail": ...}を返すが、想定外の形式
    # （ネットワーク機器のエラーページ等）が返っても落ちないようフォールバックする。
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text
