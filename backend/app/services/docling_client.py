"""Docling変換の呼び出しレイヤー（ADR-018）。

Docling本体（torch等の大容量ML依存）はdocling-serviceコンテナへ分離したため、本モジュールは
HTTP経由で`POST /convert`を呼び出すクライアントのみを持つ。
"""

from __future__ import annotations

import os
from io import BytesIO
from typing import Optional, Protocol

import httpx
from pypdf import PdfReader, PdfWriter


class PDFConversionError(Exception):
    """PDF解析の失敗。app/errors.pyのハンドラが422へ変換する（docs/spec.md 4章）。

    docling-serviceからの非200応答・接続エラー（サービスダウン等）もここへマッピングする（ADR-018）。
    """


class PDFConverter(Protocol):
    """本番/テストで差し替え可能にするための共通インターフェース（ai_client.AIClientと同じ方針）。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


# 未設定時の既定をcompose上のサービス名に合わせ、環境変数を明示しない単体実行でも動くようにする。
_DEFAULT_DOCLING_SERVICE_URL = "http://docling:8100"


class RemoteDoclingPDFConverter:
    """docling-serviceへHTTPで変換を委譲する本番実装（ADR-018）。"""

    def __init__(self, base_url: Optional[str] = None, client: Optional[httpx.Client] = None) -> None:
        # テスト側がhttpx.MockTransportを注入したClientやカスタムURLへ差し替えられるよう引数で受ける。
        self._base_url = (
            base_url or os.environ.get("DOCLING_SERVICE_URL", _DEFAULT_DOCLING_SERVICE_URL)
        ).rstrip("/")
        self._client = client or httpx.Client()

    def convert_to_html(self, filename: str, content: bytes) -> str:
        content = _first_page_only(content)
        try:
            # コンテナ起動直後の初回変換ではOCRモデルのダウンロード（実測60秒超）が発生しうるため、
            # 通常の推論時間（数秒〜十数秒）より大きめのタイムアウトを取る。
            response = self._client.post(
                f"{self._base_url}/convert",
                files={"file": (filename, content, "application/pdf")},
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


def _first_page_only(content: bytes) -> bytes:
    """PDFの1ページ目のみを残したバイト列を返す（ADR-021）。

    帳票テンプレートは1ページ完結が前提のため、2ページ目以降はDoclingの解析コストを増やすだけで
    使われない。PDFとして解析できない場合は元のバイト列をそのまま返し、検証と422化は
    docling-service側の既存エラーハンドリングに委ねる。
    """
    try:
        reader = PdfReader(BytesIO(content))
        if len(reader.pages) <= 1:
            return content
        writer = PdfWriter()
        writer.add_page(reader.pages[0])
        buffer = BytesIO()
        writer.write(buffer)
        return buffer.getvalue()
    except Exception:
        return content


def _extract_detail(response: httpx.Response) -> str:
    # docling-serviceはFastAPIのHTTPExceptionで{"detail": ...}を返すが、想定外の形式
    # （ネットワーク機器のエラーページ等）が返っても落ちないようフォールバックする。
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text


def get_pdf_converter() -> PDFConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return RemoteDoclingPDFConverter()
