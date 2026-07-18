"""PDF変換（docling_client / pdf_layout）で共通の例外と前処理（ADR-014）。

テキスト抽出（Docling、別コンテナ）とレイアウトHTML生成（PyMuPDF、backend内）は役割が
異なるが、backendから見た失敗（接続不可・解析失敗）は同じ422として扱うため、例外種別も1つに揃える。
"""

from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader, PdfWriter


class PDFConversionError(Exception):
    """PDF解析の失敗。app/errors.pyのハンドラが422へ変換する（docs/spec.md 4章）。

    docling-serviceからの非200応答・接続エラー（サービスダウン等）や、PyMuPDFでの
    レイアウトHTML生成失敗（破損PDF等）もここへマッピングする（ADR-013/015）。
    """


def first_page_only(content: bytes) -> bytes:
    """PDFの1ページ目のみを残したバイト列を返す（ADR-014）。

    帳票テンプレートは1ページ完結が前提のため、2ページ目以降は変換コストを増やすだけで使われない。
    PDFとして解析できない場合は元のバイト列をそのまま返し、検証と422化は各変換サービス側の
    既存エラーハンドリングに委ねる。
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
