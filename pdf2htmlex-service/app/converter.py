"""pdf2htmlEXによるPDF→HTML変換レイヤー（ADR-016）。

pdf2htmlEXはPDFのテキスト・フォント・背景をピクセル単位で忠実に再現したHTMLを生成する
専用バイナリ（ベースイメージpdf2htmlex/pdf2htmlexに同梱、ADR-015で一度撤去されたが
本サービスとして復活させた）。CLIをsubprocessで呼び出し、生成された単一HTMLファイルを
（フォント・画像・CSSを埋め込んだ自己完結ファイルとして）読み込んで返す。
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Protocol

# ベースイメージ（pdf2htmlex/pdf2htmlex）のENTRYPOINTと同じ絶対パス。
_PDF2HTMLEX_BIN = "/usr/local/bin/pdf2htmlEX"
_OUTPUT_FILENAME = "output.html"
_TIMEOUT_SECONDS = 120


class PDFConversionError(Exception):
    """PDF解析の失敗。app/main.pyで422 Unprocessable Entityへ変換する。"""


class PDFConverter(Protocol):
    """テスト側がdependency_overridesで高速なフェイクへ差し替えるための共通インターフェース。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


class Pdf2HtmlExConverter:
    def convert_to_html(self, filename: str, content: bytes) -> str:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            input_path = tmp_path / "input.pdf"
            input_path.write_bytes(content)

            try:
                result = subprocess.run(
                    [
                        _PDF2HTMLEX_BIN,
                        # フォント・画像・CSS・JavaScript・アウトラインを1つのHTMLへ埋め込み、
                        # 自己完結ファイルにする（外部アセットを別途配信する必要をなくす）。
                        "--embed-css",
                        "1",
                        "--embed-font",
                        "1",
                        "--embed-image",
                        "1",
                        "--embed-javascript",
                        "1",
                        "--embed-outline",
                        "1",
                        # 帳票テンプレートは1ページ完結が前提（ADR-015）。
                        "--first-page",
                        "1",
                        "--last-page",
                        "1",
                        str(input_path),
                        _OUTPUT_FILENAME,
                    ],
                    cwd=str(tmp_path),
                    capture_output=True,
                    timeout=_TIMEOUT_SECONDS,
                )
            except subprocess.TimeoutExpired as exc:
                raise PDFConversionError(f"pdf2htmlEXの実行がタイムアウトしました: {exc}") from exc
            except OSError as exc:
                raise PDFConversionError(f"pdf2htmlEXの実行に失敗しました: {exc}") from exc

            if result.returncode != 0:
                stderr = result.stderr.decode("utf-8", errors="replace")
                raise PDFConversionError(f"PDFの解析に失敗しました: {stderr}")

            output_path = tmp_path / _OUTPUT_FILENAME
            if not output_path.exists():
                raise PDFConversionError("pdf2htmlEXがHTMLファイルを生成しませんでした")

            return output_path.read_text(encoding="utf-8")


def get_pdf_converter() -> PDFConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return Pdf2HtmlExConverter()
