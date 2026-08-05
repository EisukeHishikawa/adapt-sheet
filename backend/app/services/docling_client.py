"""Doclingによるテキスト抽出（HTML）の呼び出しレイヤー。

Docling本体（torch等の大容量ML依存）はdocling-serviceコンテナへ分離しているため、本モジュールは
HTTP経由で`POST /convert`を呼び出すクライアントのみを持つ。HTTP委譲の共通処理はRemoteHtmlExtractor
（remote_extractor.py）が担い、ここではDocling固有の接続先だけを定義する。Doclingは
Markdownではなく単独のHTMLエンジンとして選択可能（AIを介さず変換結果をそのまま描画する）。
"""

from __future__ import annotations

import os

from app.services.pdf_common import PDFConversionError
from app.services.remote_extractor import PDFHtmlExtractor, RemoteHtmlExtractor

__all__ = [
    "PDFConversionError",
    "PDFHtmlExtractor",
    "RemoteDoclingHtmlExtractor",
    "get_html_extractor",
]

# ウォームアップ用の最小PDF。変換が通れば十分なため中身は空でよい。
_WARMUP_PDF = (
    b"%PDF-1.1\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]/Resources<<>>>>endobj\n"
    b"trailer<</Root 1 0 R>>\n"
    b"%%EOF\n"
)


class RemoteDoclingHtmlExtractor(RemoteHtmlExtractor):
    """docling-serviceへHTTPでテキスト抽出を委譲する本番実装。"""

    _service_label = "docling-service"
    _env_var = "DOCLING_SERVICE_URL"
    # 未設定時の既定をcompose上のサービス名に合わせ、環境変数を明示しない単体実行でも動くようにする。
    _default_url = "http://docling:8100"
    # Lambda本番はIAM認証必須のFunction URLとして公開するため、terraformがこの環境変数に
    # "aws_sigv4"を設定してSigV4署名を有効化する。
    _auth_env_var = "DOCLING_SERVICE_AUTH"
    # コールドスタートの無いdocker-compose環境では実convertを叩かずOK扱いにする。
    _skip_warmup_env_var = "DOCLING_SERVICE_SKIP_WARMUP"

    def warmup(self) -> bool:
        """最小PDFを実際に`POST /convert`へ送り、モデルパイプラインまで温める。

        基底クラスのGET /healthはプロセスを起こすだけで、DocumentConverterのモデル
        パイプライン構築（初回convert時、数秒〜十数秒）には触れない。ここを素通りすると
        ユーザーの最初のアップロードがその構築を兼ねてしまい、大きく待たせることになる。
        """
        if os.environ.get(self._skip_warmup_env_var, "").strip().lower() == "true":
            return True

        try:
            self.convert_to_html("warmup.pdf", _WARMUP_PDF)
            return True
        except PDFConversionError:
            return False


def get_html_extractor() -> PDFHtmlExtractor:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return RemoteDoclingHtmlExtractor()
