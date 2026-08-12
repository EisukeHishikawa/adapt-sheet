"""生成履歴の保存・一覧取得（app.services.history）のテスト。

実PostgreSQLは起動せず、SQLiteのin-memory DBにapp.models.Baseのメタデータをそのまま
適用して検証する（app/models.pyが方言固有型を使っていないため成立する）。
"""

import time

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import get_db_session, get_db_session_or_none
from app.main import app
from app.models import Base
from app.services.ai_client import RenderResult, get_ai_client_factory
from app.services.history import delete_history, save_history, list_history


@pytest.fixture
def session() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db_session = factory()
    yield db_session
    db_session.close()


def _save(session: Session, **overrides):
    fields = dict(
        user_id="user-1",
        engine="gemini_free",
        html="<p>{{x}}</p>",
        css="body{}",
        json_data={"x": "1"},
        width_mm=210.0,
        height_mm=297.0,
    )
    fields.update(overrides)
    return save_history(session, **fields)


def test_save_history_persists_all_fields(session):
    entry = _save(session)

    assert entry.id is not None
    assert entry.user_id == "user-1"
    assert entry.engine == "gemini_free"
    assert entry.html == "<p>{{x}}</p>"
    assert entry.css == "body{}"
    assert entry.json_data == {"x": "1"}
    assert entry.width_mm == 210.0
    assert entry.height_mm == 297.0
    assert entry.created_at is not None


def test_save_history_defaults_to_render_kind(session):
    entry = _save(session)

    assert entry.kind == "render"


def test_save_history_records_edit_kind(session):
    entry = _save(session, kind="edit")

    assert entry.kind == "edit"


def test_list_history_returns_only_matching_user_newest_first():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db_session = factory()

    first = _save(db_session, user_id="user-1", html="<p>first</p>")
    second = _save(db_session, user_id="user-1", html="<p>second</p>")
    _save(db_session, user_id="user-2", html="<p>other-user</p>")

    results = list_history(db_session, user_id="user-1")

    assert [entry.id for entry in results] == [second.id, first.id]


def test_list_history_returns_empty_for_unknown_user(session):
    _save(session, user_id="user-1")

    results = list_history(session, user_id="unknown-user")

    assert results == []


def test_list_history_caps_at_max_items(session, monkeypatch):
    import app.services.history as history_module

    monkeypatch.setattr(history_module, "MAX_HISTORY_ITEMS", 3)
    for i in range(5):
        _save(session, user_id="user-1", html=f"<p>{i}</p>")

    results = list_history(session, user_id="user-1", limit=10)

    assert len(results) == 3


# 履歴が増えても全件を返さないための絞り込み・ページング（GET /api/historyのq/kind/limit/offset）。
def test_list_history_filters_by_keyword_in_html(session):
    hit = _save(session, user_id="user-1", html="<p>請求書</p>")
    _save(session, user_id="user-1", html="<p>納品書</p>")

    results = list_history(session, user_id="user-1", query="請求")

    assert [entry.id for entry in results] == [hit.id]


def test_list_history_filters_by_keyword_in_json_data(session):
    hit = _save(session, user_id="user-1", html="<p>x</p>", json_data={"customer": "山田商店"})
    _save(session, user_id="user-1", html="<p>x</p>", json_data={"customer": "鈴木工務店"})

    results = list_history(session, user_id="user-1", query="山田")

    assert [entry.id for entry in results] == [hit.id]


def test_list_history_keyword_is_case_insensitive(session):
    hit = _save(session, user_id="user-1", html="<p>Invoice</p>")

    results = list_history(session, user_id="user-1", query="invoice")

    assert [entry.id for entry in results] == [hit.id]


def test_list_history_treats_like_wildcards_as_literals(session):
    # ユーザー入力の%や_がワイルドカードとして働くと、意図せず全件一致してしまう。
    _save(session, user_id="user-1", html="<p>invoice</p>")
    hit = _save(session, user_id="user-1", html="<p>100%</p>")

    results = list_history(session, user_id="user-1", query="100%")

    assert [entry.id for entry in results] == [hit.id]


def test_list_history_filters_by_kind(session):
    _save(session, user_id="user-1", kind="render")
    editing = _save(session, user_id="user-1", kind="edit")

    results = list_history(session, user_id="user-1", kind="edit")

    assert [entry.id for entry in results] == [editing.id]


def test_list_history_applies_limit_and_offset(session):
    saved = [_save(session, user_id="user-1", html=f"<p>{i}</p>") for i in range(5)]
    newest_first = list(reversed(saved))

    page1 = list_history(session, user_id="user-1", limit=2)
    page2 = list_history(session, user_id="user-1", limit=2, offset=2)

    assert [entry.id for entry in page1] == [newest_first[0].id, newest_first[1].id]
    assert [entry.id for entry in page2] == [newest_first[2].id, newest_first[3].id]


def test_list_history_clamps_limit_to_max_items(session, monkeypatch):
    import app.services.history as history_module

    monkeypatch.setattr(history_module, "MAX_HISTORY_ITEMS", 3)
    for i in range(5):
        _save(session, user_id="user-1", html=f"<p>{i}</p>")

    results = list_history(session, user_id="user-1", limit=100)

    assert len(results) == 3


def test_delete_history_removes_own_entry(session):
    entry = _save(session, user_id="user-1")

    assert delete_history(session, entry_id=str(entry.id), user_id="user-1") is True
    assert list_history(session, user_id="user-1") == []


def test_delete_history_keeps_other_users_entry(session):
    entry = _save(session, user_id="other-user")

    assert delete_history(session, entry_id=str(entry.id), user_id="user-1") is False
    assert len(list_history(session, user_id="other-user")) == 1


def test_delete_history_returns_false_for_invalid_id(session):
    assert delete_history(session, entry_id="not-a-uuid", user_id="user-1") is False


# 実PostgreSQLは使わず、SQLiteのin-memory DBをdependency_overridesで差し込む。

client = TestClient(app)


def _make_bearer_token(secret: str = "test-secret", sub: str = "user-123") -> str:
    payload = {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 3600}
    return f"Bearer {jwt.encode(payload, secret, algorithm='HS256')}"


def _sqlite_session() -> Session:
    # TestClientはエンドポイントをワーカースレッドで実行するため、フィクスチャ生成スレッドと
    # 異なるスレッドから同じSQLite接続を使う（check_same_thread=False）。さらに:memory:は接続
    # ごとに別DBになる既定のため、StaticPoolで単一コネクションを使い回し同じインメモリDBを共有する。
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def _override_db(db_session: Session) -> None:
    def _yield_session():
        yield db_session

    app.dependency_overrides[get_db_session] = _yield_session
    app.dependency_overrides[get_db_session_or_none] = _yield_session


def _clear_db_override() -> None:
    app.dependency_overrides.pop(get_db_session, None)
    app.dependency_overrides.pop(get_db_session_or_none, None)


def test_render_saves_history_for_logged_in_user(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    _override_db(db_session)

    class _FakeAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    app.dependency_overrides[get_ai_client_factory] = lambda: lambda engine: _FakeAIClient()
    try:
        response = client.post(
            "/api/render",
            data={"engine": "claude"},
            headers={"Authorization": _make_bearer_token()},
        )
        assert response.status_code == 200

        rows = list_history(db_session, user_id="user-123")
        assert len(rows) == 1
        assert rows[0].engine == "claude"
        assert rows[0].html == "<p>{{x}}</p>"
        assert rows[0].json_data == {"x": "1"}
    finally:
        app.dependency_overrides.pop(get_ai_client_factory, None)
        _clear_db_override()


def test_render_does_not_save_history_when_not_logged_in():
    db_session = _sqlite_session()
    _override_db(db_session)
    try:
        response = client.post("/api/render", data={})
        assert response.status_code == 200
        assert list_history(db_session, user_id="user-123") == []
    finally:
        _clear_db_override()


def test_render_still_succeeds_when_history_save_fails(monkeypatch):
    # DB保存が失敗しても、描画自体のレスポンスは失敗させない（main._save_historyのtry/except）。
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    db_session.close()  # 閉じたセッションでcommitさせ、保存を意図的に失敗させる。
    _override_db(db_session)
    try:
        response = client.post(
            "/api/render",
            data={},
            headers={"Authorization": _make_bearer_token()},
        )
        assert response.status_code == 200
    finally:
        _clear_db_override()


def test_get_history_returns_403_when_not_logged_in():
    db_session = _sqlite_session()
    _override_db(db_session)
    try:
        response = client.get("/api/history")
        assert response.status_code == 403
    finally:
        _clear_db_override()


def test_get_history_returns_saved_entries_for_logged_in_user(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    save_history(
        db_session,
        user_id="user-123",
        engine="gemini_free",
        html="<p>hi</p>",
        css="",
        json_data={},
        width_mm=210.0,
        height_mm=297.0,
    )
    _override_db(db_session)
    try:
        response = client.get("/api/history", headers={"Authorization": _make_bearer_token()})
        assert response.status_code == 200

        body = response.json()
        assert len(body) == 1
        assert body[0]["engine"] == "gemini_free"
        assert body[0]["html"] == "<p>hi</p>"
        assert body[0]["width_mm"] == 210.0
        # 描画由来の履歴はkind="render"（編集中スナップショットと区別する）。
        assert body[0]["kind"] == "render"
        assert "id" in body[0]
        assert "created_at" in body[0]
    finally:
        _clear_db_override()


# 編集中スナップショットの保存（POST /api/history/edit）。描画を経ずにエディタの内容を
# kind="edit"として保存し、フロントの「編集中」カードと同じ粒度でサーバー側にも残す。
def test_post_history_edit_saves_snapshot_with_edit_kind(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    _override_db(db_session)
    try:
        response = client.post(
            "/api/history/edit",
            json={
                "engine": "gemini_free",
                "html": "<p>{{x}}</p>",
                "css": "body{}",
                "json": {"x": "1"},
                "width_mm": 210.0,
                "height_mm": 297.0,
            },
            headers={"Authorization": _make_bearer_token()},
        )
        assert response.status_code == 201
        assert response.json()["kind"] == "edit"

        rows = list_history(db_session, user_id="user-123")
        assert len(rows) == 1
        assert rows[0].kind == "edit"
        assert rows[0].html == "<p>{{x}}</p>"
        assert rows[0].json_data == {"x": "1"}
    finally:
        _clear_db_override()


def test_put_history_edit_updates_existing_snapshot(monkeypatch):
    # 編集中スナップショットを編集し続けても行は増やさず、同じ行を上書きする。
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    existing = save_history(
        db_session,
        user_id="user-123",
        engine="gemini_free",
        html="<p>before</p>",
        css="",
        json_data={},
        width_mm=None,
        height_mm=None,
        kind="edit",
    )
    _override_db(db_session)
    try:
        response = client.put(
            f"/api/history/edit/{existing.id}",
            json={"engine": "gemini_free", "html": "<p>after</p>", "css": "", "json": {"x": "1"}},
            headers={"Authorization": _make_bearer_token()},
        )
        assert response.status_code == 200
        assert response.json()["html"] == "<p>after</p>"

        rows = list_history(db_session, user_id="user-123")
        assert len(rows) == 1
        assert rows[0].html == "<p>after</p>"
        assert rows[0].kind == "edit"
    finally:
        _clear_db_override()


def test_put_history_edit_returns_404_for_other_users_row(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    existing = save_history(
        db_session,
        user_id="other-user",
        engine="gemini_free",
        html="<p>other</p>",
        css="",
        json_data={},
        width_mm=None,
        height_mm=None,
        kind="edit",
    )
    _override_db(db_session)
    try:
        response = client.put(
            f"/api/history/edit/{existing.id}",
            json={"html": "<p>hacked</p>"},
            headers={"Authorization": _make_bearer_token(sub="user-123")},
        )
        assert response.status_code == 404
        assert list_history(db_session, user_id="other-user")[0].html == "<p>other</p>"
    finally:
        _clear_db_override()


def test_put_history_edit_returns_403_when_not_logged_in():
    db_session = _sqlite_session()
    _override_db(db_session)
    try:
        response = client.put(
            "/api/history/edit/00000000-0000-0000-0000-000000000000",
            json={"html": "<p>x</p>"},
        )
        assert response.status_code == 403
    finally:
        _clear_db_override()


def test_post_history_edit_returns_403_when_not_logged_in():
    db_session = _sqlite_session()
    _override_db(db_session)
    try:
        response = client.post("/api/history/edit", json={"html": "<p>x</p>"})
        assert response.status_code == 403
        assert list_history(db_session, user_id="user-123") == []
    finally:
        _clear_db_override()


def test_get_history_includes_edit_snapshots(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    save_history(
        db_session,
        user_id="user-123",
        engine="gemini_free",
        html="<p>editing</p>",
        css="",
        json_data={},
        width_mm=None,
        height_mm=None,
        kind="edit",
    )
    _override_db(db_session)
    try:
        response = client.get("/api/history", headers={"Authorization": _make_bearer_token()})
        assert response.status_code == 200
        assert [item["kind"] for item in response.json()] == ["edit"]
    finally:
        _clear_db_override()


def test_get_history_filters_by_query_and_kind(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    for html, kind in (("<p>請求書</p>", "render"), ("<p>納品書</p>", "render"), ("<p>請求書</p>", "edit")):
        save_history(
            db_session,
            user_id="user-123",
            engine="gemini_free",
            html=html,
            css="",
            json_data={},
            width_mm=None,
            height_mm=None,
            kind=kind,
        )
    _override_db(db_session)
    try:
        response = client.get(
            "/api/history",
            params={"q": "請求", "kind": "render"},
            headers={"Authorization": _make_bearer_token()},
        )
        assert response.status_code == 200

        body = response.json()
        assert [(item["html"], item["kind"]) for item in body] == [("<p>請求書</p>", "render")]
    finally:
        _clear_db_override()


def test_get_history_returns_only_requested_page(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    for i in range(3):
        save_history(
            db_session,
            user_id="user-123",
            engine="gemini_free",
            html=f"<p>{i}</p>",
            css="",
            json_data={},
            width_mm=None,
            height_mm=None,
        )
    _override_db(db_session)
    try:
        response = client.get(
            "/api/history",
            params={"limit": 2, "offset": 2},
            headers={"Authorization": _make_bearer_token()},
        )
        assert response.status_code == 200
        assert [item["html"] for item in response.json()] == ["<p>0</p>"]
    finally:
        _clear_db_override()


def test_get_history_rejects_unknown_kind(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    _override_db(db_session)
    try:
        response = client.get(
            "/api/history",
            params={"kind": "unknown"},
            headers={"Authorization": _make_bearer_token()},
        )
        # 検証エラーはapp/errors.pyが400へ揃えている。
        assert response.status_code == 400
    finally:
        _clear_db_override()


def test_delete_history_removes_own_entry_via_api(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    entry = save_history(
        db_session,
        user_id="user-123",
        engine="gemini_free",
        html="<p>delete me</p>",
        css="",
        json_data={},
        width_mm=None,
        height_mm=None,
    )
    _override_db(db_session)
    try:
        response = client.delete(f"/api/history/{entry.id}", headers={"Authorization": _make_bearer_token()})
        assert response.status_code == 204
        assert list_history(db_session, user_id="user-123") == []
    finally:
        _clear_db_override()


def test_delete_history_returns_404_for_other_users_entry(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    entry = save_history(
        db_session,
        user_id="other-user",
        engine="gemini_free",
        html="<p>other</p>",
        css="",
        json_data={},
        width_mm=None,
        height_mm=None,
    )
    _override_db(db_session)
    try:
        response = client.delete(
            f"/api/history/{entry.id}", headers={"Authorization": _make_bearer_token(sub="user-123")}
        )
        assert response.status_code == 404
        assert len(list_history(db_session, user_id="other-user")) == 1
    finally:
        _clear_db_override()


def test_delete_history_returns_403_when_not_logged_in():
    db_session = _sqlite_session()
    _override_db(db_session)
    try:
        response = client.delete("/api/history/00000000-0000-0000-0000-000000000000")
        assert response.status_code == 403
    finally:
        _clear_db_override()


def test_get_history_does_not_return_other_users_entries(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    db_session = _sqlite_session()
    save_history(
        db_session,
        user_id="other-user",
        engine="gemini_free",
        html="<p>other</p>",
        css="",
        json_data={},
        width_mm=None,
        height_mm=None,
    )
    _override_db(db_session)
    try:
        response = client.get("/api/history", headers={"Authorization": _make_bearer_token(sub="user-123")})
        assert response.status_code == 200
        assert response.json() == []
    finally:
        _clear_db_override()
