"""pdf2htmlEXによるPDF→レイアウトHTML変換レイヤー（ADR-023）。

pdf2htmlEXはPDFの見た目（座標・罫線・フォント）を絶対配置のdivとして忠実に再現する。
テキストの論理構造（見出し・表）の抽出はdocling-service側の責務であり、本サービスは
「見た目のソース」だけを返す。
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Protocol


class PDFConversionError(Exception):
    """PDF変換の失敗。app/main.pyで422 Unprocessable Entityへ変換する。"""


class PDFConverter(Protocol):
    """テスト側がdependency_overridesで高速なフェイクへ差し替えるための共通インターフェース。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


class Pdf2htmlEXConverter:
    def __init__(self) -> None:
        self._zoom = os.getenv("PDF2HTMLEX_ZOOM", "1.5")
        # 大文字=埋め込み・小文字=外部ファイル。単一HTMLとしてbackendへ返す必要があるため、
        # CSS(C)・フォント(F)・画像(I)・JS(J)をすべて埋め込む。
        self._embed = os.getenv("PDF2HTMLEX_EMBED", "CFIJ")
        # 罫線・図形はラスタライズされた背景画像として再現される。0にするとテキストのみになる。
        self._process_nontext = os.getenv("PDF2HTMLEX_PROCESS_NONTEXT", "1")
        self._timeout_seconds = float(os.getenv("PDF2HTMLEX_TIMEOUT_SECONDS", "120"))

    def convert_to_html(self, filename: str, content: bytes) -> str:
        with tempfile.TemporaryDirectory() as work_dir:
            # 入力ファイル名はユーザー由来のため、パス操作を避けて固定名で書き出す。
            input_path = Path(work_dir) / "input.pdf"
            output_path = Path(work_dir) / "output.html"
            input_path.write_bytes(content)

            try:
                completed = subprocess.run(
                    [
                        "pdf2htmlEX",
                        "--zoom",
                        self._zoom,
                        "--embed",
                        self._embed,
                        "--split-pages",
                        "0",
                        "--process-outline",
                        "0",
                        "--process-nontext",
                        self._process_nontext,
                        # 帳票テンプレートは1ページ完結が前提（ADR-021）。
                        "--first-page",
                        "1",
                        "--last-page",
                        "1",
                        "--dest-dir",
                        work_dir,
                        str(input_path),
                        output_path.name,
                    ],
                    capture_output=True,
                    timeout=self._timeout_seconds,
                )
            except subprocess.TimeoutExpired as exc:
                raise PDFConversionError("PDFの解析がタイムアウトしました") from exc
            except OSError as exc:
                raise PDFConversionError(f"pdf2htmlEXの起動に失敗しました: {exc}") from exc

            if completed.returncode != 0 or not output_path.exists():
                # 破損PDF・パスワード保護PDF等。pdf2htmlEXの診断メッセージはstderrに出る。
                detail = completed.stderr.decode("utf-8", errors="replace").strip()
                raise PDFConversionError(f"PDFの解析に失敗しました: {detail}")

            return output_path.read_text(encoding="utf-8")


def get_pdf_converter() -> PDFConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return Pdf2htmlEXConverter()
