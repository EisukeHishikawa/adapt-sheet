"""PDF変換クライアント（docling_client / pdf2htmlex_client）で共通の例外と前処理（ADR-023）。

2つの変換サービスは役割が異なるが、backendから見た失敗（接続不可・解析失敗）は同じ422として
扱うため、例外種別も1つに揃える。
"""

from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader, PdfWriter


class PDFConversionError(Exception):
    """PDF解析の失敗。app/errors.pyのハンドラが422へ変換する（docs/spec.md 4章）。

    docling-service / pdf2htmlex-serviceからの非200応答・接続エラー（サービスダウン等）も
    ここへマッピングする（ADR-018/023）。
    """


def first_page_only(content: bytes) -> bytes:
    """PDFの1ページ目のみを残したバイト列を返す（ADR-021）。

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
