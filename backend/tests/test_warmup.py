"""POST /api/warmup（フロント表示時のホットスタンバイ、ADR-028）のテスト。

このエンドポイントは「Lambdaの実行環境を起こす」「SupabaseのDBへ最小のクエリを投げて
無操作扱いを避ける」ためだけのもので、結果は画面の挙動を左右しない。したがって
どの対象が失敗しても常に200を返し、対象ごとの成否のみをボディで返すことを検証する。
"""

from fastapi.testclient import TestClient

from app.db import get_db_pinger
from app.main import app
from app.services.docling_client import get_html_extractor
from app.services.pdf2htmlex_client import get_pdf2htmlex_extractor

client = TestClient(app)


class _FakeExtractor:
    def __init__(self, result: bool) -> None:
        self._result = result
        self.called = 0

    def convert_to_html(self, filename: str, content: bytes) -> str:  # pragma: no cover
        raise AssertionError("/api/warmupは変換を呼び出してはならない")

    def warmup(self) -> bool:
        self.called += 1
        return self._result


def _override(docling: _FakeExtractor, pdf2htmlex: _FakeExtractor, db_result: bool) -> None:
    app.dependency_overrides[get_html_extractor] = lambda: docling
    app.dependency_overrides[get_pdf2htmlex_extractor] = lambda: pdf2htmlex
    app.dependency_overrides[get_db_pinger] = lambda: (lambda: db_result)


def _clear_overrides() -> None:
    for dependency in (get_html_extractor, get_pdf2htmlex_extractor, get_db_pinger):
        app.dependency_overrides.pop(dependency, None)


def test_warmup_pings_both_services_and_database():
    docling, pdf2htmlex = _FakeExtractor(True), _FakeExtractor(True)
    _override(docling, pdf2htmlex, db_result=True)
    try:
        response = client.post("/api/warmup")

        assert response.status_code == 200
        assert response.json() == {"docling": "ok", "pdf2htmlex": "ok", "database": "ok"}
        assert docling.called == 1
        assert pdf2htmlex.called == 1
    finally:
        _clear_overrides()


def test_warmup_returns_200_even_when_every_target_is_unavailable():
    _override(_FakeExtractor(False), _FakeExtractor(False), db_result=False)
    try:
        response = client.post("/api/warmup")

        assert response.status_code == 200
        assert response.json() == {
            "docling": "unavailable",
            "pdf2htmlex": "unavailable",
            "database": "unavailable",
        }
    finally:
        _clear_overrides()


def test_warmup_does_not_require_authentication():
    # 未ログインでも叩ける（Authorizationヘッダー無し）。画面を開いた時点で投げるため。
    _override(_FakeExtractor(True), _FakeExtractor(True), db_result=True)
    try:
        assert client.post("/api/warmup").status_code == 200
    finally:
        _clear_overrides()


def test_warmup_reports_unavailable_when_extractor_raises():
    class _RaisingExtractor(_FakeExtractor):
        def warmup(self) -> bool:
            raise RuntimeError("想定外のエラー")

    _override(_RaisingExtractor(False), _FakeExtractor(True), db_result=True)
    try:
        response = client.post("/api/warmup")

        assert response.status_code == 200
        assert response.json()["docling"] == "unavailable"
        assert response.json()["pdf2htmlex"] == "ok"
    finally:
        _clear_overrides()
