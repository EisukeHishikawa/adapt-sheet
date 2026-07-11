"""Docling変換の呼び出しレイヤー（DEVELOPMENT.md ステップ7→ステップ15）。

ADR-018に基づき、Docling本体（torch等の大容量ML依存）はdocling-serviceコンテナへ分離した。
本モジュールはHTTP経由でdocling-serviceの`POST /convert`を呼び出すクライアントのみを持つ。
PDFConverterプロトコル自体はステップ7から変更していないため、app/main.pyのDI配線・
docs/spec.md 3.1の外部API契約（/api/render）は無変更のまま分離できる。

adapt-sheetの帳票テンプレートは1ページ完結が前提のため、docling-serviceへ転送する前に
`_first_page_only`で2ページ目以降を破棄する（Docling側の処理時間を1ページ分に抑えるため）。
"""

from __future__ import annotations

import os
from io import BytesIO
from typing import Optional, Protocol

import httpx
from pypdf import PdfReader, PdfWriter


class PDFConversionError(Exception):
    """PDF解析に失敗した場合の例外。

    docs/spec.mdのエラーコード定義に合わせ、呼び出し側（app/main.py）で
    422 Unprocessable Entityへ変換することを想定する。docling-serviceからの非200応答・
    接続エラー（サービスダウン等）もここへマッピングする（ADR-018）。
    """


class PDFConverter(Protocol):
    """本番/テストで差し替え可能にするための共通インターフェース。

    ai_client.AIClientと同様、FastAPIのDependsで注入し、
    テスト側がdependency_overridesで高速なフェイクに差し替えられるようにする。
    """

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


# docker-compose.ymlのbackendサービスに設定される内部サービスURL（サービス名docling、ADR-018）。
# 未設定時のデフォルトもcompose上のサービス名に合わせておくことで、環境変数を明示しない
# 単体実行（スクリプト等）でも同じ既定値で動作する。
_DEFAULT_DOCLING_SERVICE_URL = "http://docling:8100"


class RemoteDoclingPDFConverter:
    """docling-serviceへHTTPで変換を委譲する本番実装（ADR-018）。"""

    def __init__(self, base_url: Optional[str] = None, client: Optional[httpx.Client] = None) -> None:
        # base_url/clientをコンストラクタ引数で受けられるようにし、テスト側がhttpx.MockTransportを
        # 注入したClientやカスタムURLに差し替えられるようにする。
        self._base_url = (
            base_url or os.environ.get("DOCLING_SERVICE_URL", _DEFAULT_DOCLING_SERVICE_URL)
        ).rstrip("/")
        self._client = client or httpx.Client()

    def convert_to_html(self, filename: str, content: bytes) -> str:
        content = _first_page_only(content)
        try:
            # ローカル開発でdocling-serviceコンテナを起動した直後の初回変換は、OCRモデルの
            # 初回ダウンロード（実測で60秒超）が発生しうるため、通常の推論時間（数秒〜十数秒）
            # より大きめの120秒を設定する。モデルはコンテナ内にキャッシュされるため2回目以降は短い。
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
    """PDFの1ページ目のみを残したバイト列を返す。

    adapt-sheetの帳票テンプレートは1ページ完結が前提のため、2ページ目以降をDoclingへ
    送っても解析コスト（処理時間）が増えるだけで使われない。docling-serviceへ転送する前に
    ここで切り詰める。PDFとして解析できない場合（壊れている等）は、そのままの検証・422化を
    docling-service側の既存エラーハンドリングに委ねるため、元のバイト列を無変更で返す。
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
    # docling-service側はFastAPIのHTTPExceptionで{"detail": ...}形式を返す（app/main.py参照）。
    # 想定外の形式（ネットワーク機器のエラーページ等）が返った場合も落ちないようフォールバックする。
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text


def get_pdf_converter() -> PDFConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return RemoteDoclingPDFConverter()
