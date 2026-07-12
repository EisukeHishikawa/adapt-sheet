"""pdf2htmlEXによるPDF→レイアウトHTML変換レイヤー（ADR-023）。

pdf2htmlEXはPDFの見た目（座標・罫線・フォント）を絶対配置のdivとして忠実に再現する。
テキストの論理構造（見出し・表）の抽出はdocling-service側の責務であり、本サービスは
「見た目のソース」だけを返す。

出力の唯一の宛先はGeminiのプロンプトであるため、埋め込みフォント・背景画像（base64）や
boilerplateのJSは含めない。これらはLLMが読めない一方でペイロードの大半を占め、Gemini APIが
503を返す原因になる（ADR-023）。
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Protocol

# LLMが解釈できない資産（base64のdata URI・boilerplateのJS）と、HTML1枚では解決できない
# 外部ファイル参照を落とすためのパターン。
_SCRIPT_TAG_PATTERN = re.compile(r"<script[^>]*>.*?</script>", re.DOTALL | re.IGNORECASE)
_LINK_TAG_PATTERN = re.compile(r"<link[^>]*>", re.IGNORECASE)
_DATA_URI_PATTERN = re.compile(r"url\(\s*['\"]?data:[^)]*\)", re.IGNORECASE)


class PDFConversionError(Exception):
    """PDF変換の失敗。app/main.pyで422 Unprocessable Entityへ変換する。"""


class PDFConverter(Protocol):
    """テスト側がdependency_overridesで高速なフェイクへ差し替えるための共通インターフェース。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...


class Pdf2htmlEXConverter:
    def __init__(self) -> None:
        self._zoom = os.getenv("PDF2HTMLEX_ZOOM", "1.5")
        # 大文字=埋め込み・小文字=外部ファイル。レイアウトを表すCSS(C)だけを埋め込み、
        # フォント(f)・画像(i)・JS(j)は埋め込まない（Geminiが読めずトークンを浪費するため）。
        self._embed = os.getenv("PDF2HTMLEX_EMBED", "Cfij")
        # 罫線・図形はラスタライズした背景画像として再現されるが、画像はGeminiへ渡らないため
        # 既定では生成しない。罫線・表構造はDocling由来のMarkdownから読み取らせる。
        self._process_nontext = os.getenv("PDF2HTMLEX_PROCESS_NONTEXT", "0")
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

            return _strip_non_layout_assets(output_path.read_text(encoding="utf-8"))


def _strip_non_layout_assets(html: str) -> str:
    """レイアウトの理解に寄与しない要素を落とす（ADR-023）。

    `--embed Cfij`でもpdf2htmlEXのビューアJS・外部ファイルへの参照・fancy.css内のロゴ画像
    （data URI）は残るため、ここで除去する。座標や字送りを持つCSSクラス定義は残す。
    """
    html = _SCRIPT_TAG_PATTERN.sub("", html)
    html = _LINK_TAG_PATTERN.sub("", html)
    return _DATA_URI_PATTERN.sub("url()", html)


def get_pdf_converter() -> PDFConverter:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return Pdf2htmlEXConverter()
