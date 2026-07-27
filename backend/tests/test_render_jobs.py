"""非同期レンダリングジョブ用エンドポイント（POST /api/render/upload-url・
POST /api/render/jobs・GET /api/render/jobs/{job_id}・POST /internal/render-jobs/process）
のテスト。

実S3・実Lambdaは呼ばず、job_store/worker_invokerをdependency_overridesでフェイクへ
差し替える。
"""

import time

import jwt
from fastapi.testclient import TestClient

from app.main import app
from app.services.ai_client import AIGenerationError, RenderResult, get_ai_client_factory
from app.services.job_store import get_job_store
from app.services.worker_invoker import get_worker_invoker

client = TestClient(app)


class _FakeJobStore:
    def __init__(self) -> None:
        self.statuses: dict[str, dict] = {}
        self.uploaded: dict[str, bytes] = {}
        self._next_id = 0

    def new_job_id(self) -> str:
        self._next_id += 1
        return f"job-{self._next_id}"

    def presigned_upload_url(self, job_id: str) -> str:
        return f"https://example.com/uploads/{job_id}.pdf?signed=1"

    def fetch_uploaded_pdf(self, job_id: str) -> bytes:
        return self.uploaded[job_id]

    def write_status(self, job_id: str, payload: dict) -> None:
        self.statuses[job_id] = payload

    def read_status(self, job_id: str):
        return self.statuses.get(job_id)


class _FakeWorkerInvoker:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def invoke(self, path: str, body: dict) -> None:
        self.calls.append((path, body))


def _override_job_store() -> _FakeJobStore:
    fake = _FakeJobStore()
    app.dependency_overrides[get_job_store] = lambda: fake
    return fake


def _override_worker_invoker() -> _FakeWorkerInvoker:
    fake = _FakeWorkerInvoker()
    app.dependency_overrides[get_worker_invoker] = lambda: fake
    return fake


def _clear_overrides() -> None:
    app.dependency_overrides.pop(get_job_store, None)
    app.dependency_overrides.pop(get_worker_invoker, None)
    app.dependency_overrides.pop(get_ai_client_factory, None)


def _make_bearer_token(secret: str, **claims) -> str:
    payload = {"sub": "user-123", "aud": "authenticated", "exp": int(time.time()) + 3600, **claims}
    return f"Bearer {jwt.encode(payload, secret, algorithm='HS256')}"


def test_create_upload_url_returns_job_id_and_url():
    job_store = _override_job_store()
    try:
        response = client.post("/api/render/upload-url")
        assert response.status_code == 200
        body = response.json()
        assert body["job_id"] in job_store.statuses or body["job_id"]  # 発行されたjob_idが返る
        assert body["upload_url"].endswith(f"{body['job_id']}.pdf?signed=1")
    finally:
        _clear_overrides()


def test_create_render_job_writes_pending_status_and_invokes_worker():
    job_store = _override_job_store()
    worker_invoker = _override_worker_invoker()
    try:
        response = client.post(
            "/api/render/jobs",
            json={"engine": "gemini_free", "prompt": "請求書にして"},
        )
        assert response.status_code == 202
        job_id = response.json()["job_id"]

        assert job_store.statuses[job_id] == {"status": "pending"}
        assert len(worker_invoker.calls) == 1
        path, body = worker_invoker.calls[0]
        assert path == "/internal/render-jobs/process"
        assert body["job_id"] == job_id
        assert body["engine"] == "gemini_free"
        assert body["prompt"] == "請求書にして"
        assert body["user_id"] is None
    finally:
        _clear_overrides()


def test_create_render_job_returns_403_for_gated_engine_without_login():
    _override_job_store()
    worker_invoker = _override_worker_invoker()
    try:
        response = client.post("/api/render/jobs", json={"engine": "claude"})
        assert response.status_code == 403
        # ゲートで弾かれるため、workerは起動されない。
        assert worker_invoker.calls == []
    finally:
        _clear_overrides()


def test_create_render_job_passes_user_id_when_logged_in(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "test-secret")
    _override_job_store()
    worker_invoker = _override_worker_invoker()
    try:
        response = client.post(
            "/api/render/jobs",
            json={"engine": "claude"},
            headers={"Authorization": _make_bearer_token("test-secret")},
        )
        assert response.status_code == 202
        _, body = worker_invoker.calls[0]
        assert body["user_id"] == "user-123"
    finally:
        _clear_overrides()


def test_create_render_job_reuses_job_id_from_upload_url():
    job_store = _override_job_store()
    _override_worker_invoker()
    try:
        response = client.post(
            "/api/render/jobs",
            json={"engine": "gemini_free", "job_id": "job-existing", "has_pdf": True},
        )
        assert response.status_code == 202
        assert response.json()["job_id"] == "job-existing"
        assert "job-existing" in job_store.statuses
    finally:
        _clear_overrides()


def test_get_render_job_returns_status():
    job_store = _override_job_store()
    try:
        job_store.statuses["job-1"] = {"status": "done", "html": "<p>x</p>", "css": "", "json": {"x": 1}}
        response = client.get("/api/render/jobs/job-1")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "done"
        assert body["html"] == "<p>x</p>"
        assert body["json"] == {"x": 1}
    finally:
        _clear_overrides()


def test_get_render_job_returns_404_when_unknown():
    _override_job_store()
    try:
        response = client.get("/api/render/jobs/unknown-job")
        assert response.status_code == 404
    finally:
        _clear_overrides()


def test_process_render_job_writes_done_status_on_success():
    job_store = _override_job_store()

    class _FakeAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    app.dependency_overrides[get_ai_client_factory] = lambda: (lambda engine: _FakeAIClient())
    try:
        response = client.post(
            "/internal/render-jobs/process",
            json={"job_id": "job-1", "engine": "gemini_free", "prompt": "請求書"},
        )
        assert response.status_code == 202
        assert job_store.statuses["job-1"] == {
            "status": "done",
            "html": "<p>{{x}}</p>",
            "css": "body{}",
            "json": {"x": "1"},
        }
    finally:
        _clear_overrides()


def test_process_render_job_writes_error_status_on_ai_generation_error():
    job_store = _override_job_store()

    class _FailingAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            raise AIGenerationError("AI呼び出しに失敗しました（テスト用）")

    app.dependency_overrides[get_ai_client_factory] = lambda: (lambda engine: _FailingAIClient())
    try:
        response = client.post(
            "/internal/render-jobs/process",
            json={"job_id": "job-1", "engine": "gemini_free"},
        )
        assert response.status_code == 202
        assert job_store.statuses["job-1"]["status"] == "error"
        assert "AI呼び出しに失敗しました" in job_store.statuses["job-1"]["message"]
    finally:
        _clear_overrides()


def test_process_render_job_fetches_uploaded_pdf_when_has_pdf_true():
    job_store = _override_job_store()
    job_store.uploaded["job-1"] = b"%PDF-1.4 dummy"

    captured = {}

    class _RecordingAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            captured["pdf"] = pdf
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    app.dependency_overrides[get_ai_client_factory] = lambda: (lambda engine: _RecordingAIClient())
    try:
        response = client.post(
            "/internal/render-jobs/process",
            json={"job_id": "job-1", "engine": "gemini_free", "has_pdf": True},
        )
        assert response.status_code == 202
        assert captured["pdf"] == b"%PDF-1.4 dummy"
    finally:
        _clear_overrides()


def test_process_render_job_saves_history_when_user_id_present(monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.models import Base
    from app.services import history as history_module

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    import app.db as db_module

    monkeypatch.setattr(db_module, "_get_session_factory", lambda: factory)

    job_store = _override_job_store()

    class _FakeAIClient:
        def generate(self, prompt: str, pdf=None) -> RenderResult:
            return RenderResult(html="<p>{{x}}</p>", css="body{}", data={"x": "1"})

    app.dependency_overrides[get_ai_client_factory] = lambda: (lambda engine: _FakeAIClient())
    try:
        response = client.post(
            "/internal/render-jobs/process",
            json={"job_id": "job-1", "engine": "gemini_free", "user_id": "user-123"},
        )
        assert response.status_code == 202
        assert job_store.statuses["job-1"]["status"] == "done"

        with factory() as session:
            rows = history_module.list_history(session, user_id="user-123")
        assert len(rows) == 1
        assert rows[0].html == "<p>{{x}}</p>"
    finally:
        _clear_overrides()
