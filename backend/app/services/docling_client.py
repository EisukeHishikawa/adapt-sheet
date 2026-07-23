"""Doclingによるテキスト抽出（HTML）の呼び出しレイヤー（ADR-013/016）。

Docling本体（torch等の大容量ML依存）はdocling-serviceコンテナへ分離しているため、本モジュールは
HTTP経由で`POST /convert`を呼び出すクライアントのみを持つ。HTTP委譲の共通処理はRemoteHtmlExtractor
（remote_extractor.py）が担い、ここではDocling固有の接続先だけを定義する。ADR-015により、Doclingは
Markdownではなく単独のHTMLエンジンとして選択可能（AIを介さず変換結果をそのまま描画する）。
"""

from __future__ import annotations

from app.services.pdf_common import PDFConversionError
from app.services.remote_extractor import PDFHtmlExtractor, RemoteHtmlExtractor

__all__ = [
    "PDFConversionError",
    "PDFHtmlExtractor",
    "RemoteDoclingHtmlExtractor",
    "get_html_extractor",
]


class RemoteDoclingHtmlExtractor(RemoteHtmlExtractor):
    """docling-serviceへHTTPでテキスト抽出を委譲する本番実装（ADR-013/016/026）。"""

    _service_label = "docling-service"
    _env_var = "DOCLING_SERVICE_URL"
    # 未設定時の既定をcompose上のサービス名に合わせ、環境変数を明示しない単体実行でも動くようにする。
    _default_url = "http://docling:8100"
    # Lambda本番はIAM認証必須のFunction URLとして公開するため、terraformがこの環境変数に
    # "aws_sigv4"を設定してSigV4署名を有効化する（ADR-026）。
    _auth_env_var = "DOCLING_SERVICE_AUTH"


def get_html_extractor() -> PDFHtmlExtractor:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return RemoteDoclingHtmlExtractor()
