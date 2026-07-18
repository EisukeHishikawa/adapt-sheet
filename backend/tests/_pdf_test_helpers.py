"""docling_client/pdf2htmlex_clientのテストで共用するPDF・HTTPモックのヘルパー。

両クライアントは同じHTTP委譲の形（multipart/form-dataでfileを送る）を持つため、
組み立て・検証のヘルパーが重複しないようここへ集約する。
"""

from __future__ import annotations

import email
from io import BytesIO

import httpx
from pypdf import PdfWriter


def client_with(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def build_multi_page_pdf(page_widths: list) -> bytes:
    # ページごとにmediaboxの幅を変えることで、どのページが送信されたかを識別できるようにする。
    writer = PdfWriter()
    for width in page_widths:
        writer.add_blank_page(width=width, height=300)
    buffer = BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def extract_uploaded_file_bytes(request: httpx.Request) -> bytes:
    # httpxのmultipart/form-dataボディはemail.message互換の形式のため、Content-Typeヘッダー
    # （boundary情報を含む）を先頭に付与した上でemailパーサーに渡し、"file"パートの本体を取り出す。
    content_type = request.headers["content-type"]
    raw = f"Content-Type: {content_type}\r\n\r\n".encode() + request.content
    message = email.message_from_bytes(raw)
    for part in message.get_payload():
        if part.get_param("name", header="Content-Disposition") == "file":
            return part.get_payload(decode=True)
    raise AssertionError("multipartリクエストにfileパートが見つからない")
