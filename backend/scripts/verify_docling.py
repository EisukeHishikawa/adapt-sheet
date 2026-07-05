"""Docling事前検証スクリプト。

ローカル環境（OS依存のライブラリ/MLモデル）でPDFから
最低限テキスト抽出できるかを早期に確認するための単体スクリプト。
`python scripts/verify_docling.py` で実行する。
"""

import sys
from pathlib import Path

from docling.document_converter import DocumentConverter

# tests/fixtures/sample.pdf はmacOS標準の cupsfilter でテキストから生成したPDF
# （Doclingの動作確認のみが目的のため、実際の帳票PDFである必要はない）。
SAMPLE_PDF = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "sample.pdf"


def main() -> int:
    if not SAMPLE_PDF.exists():
        print(f"サンプルPDFが見つかりません: {SAMPLE_PDF}")
        return 1

    # DocumentConverterがOS依存のバイナリ/MLモデルを内包するため、
    # ここで例外なく変換できることがCLAUDE.mdの「環境依存の注意点」に対する早期検証になる。
    converter = DocumentConverter()
    result = converter.convert(str(SAMPLE_PDF))
    text = result.document.export_to_text()

    print("--- 抽出テキスト ---")
    print(text)

    # PDFに埋め込んだ既知の文字列が抽出できているかで、テキスト抽出の成否を判定する。
    if "Docling verification sample text" not in text:
        print("期待したテキストが抽出できませんでした")
        return 1

    print("--- Docling検証成功 ---")
    return 0


if __name__ == "__main__":
    sys.exit(main())
