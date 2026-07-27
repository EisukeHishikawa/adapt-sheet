"""job_store.py（非同期レンダリングジョブのS3読み書き）のテスト。

実S3は起動せず、boto3クライアントをフェイクへ差し替えて呼び出しの配線のみを検証する。
"""

import json

import pytest

from app.services.job_store import JobStoreError, S3JobStore, get_job_store


class _FakeNoSuchKey(Exception):
    pass


class _FakeExceptions:
    NoSuchKey = _FakeNoSuchKey


class _FakeBody:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


class _FakeS3Client:
    exceptions = _FakeExceptions

    def __init__(self) -> None:
        self.presign_calls: list[tuple] = []
        self.put_calls: list[tuple] = []
        self.objects: dict[str, bytes] = {}

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        self.presign_calls.append((operation, Params, ExpiresIn))
        return f"https://example.com/{Params['Key']}?signed=1"

    def put_object(self, Bucket, Key, Body, ContentType):
        self.put_calls.append((Bucket, Key, Body, ContentType))
        self.objects[Key] = Body

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise self.exceptions.NoSuchKey()
        return {"Body": _FakeBody(self.objects[Key])}


def test_constructor_raises_when_bucket_unset(monkeypatch):
    monkeypatch.delenv("RENDER_JOBS_BUCKET", raising=False)
    with pytest.raises(JobStoreError):
        S3JobStore()


def test_new_job_id_returns_unique_uuids():
    store = S3JobStore(bucket="test-bucket")
    assert store.new_job_id() != store.new_job_id()


def test_presigned_upload_url_targets_uploads_prefix(monkeypatch):
    fake_client = _FakeS3Client()
    store = S3JobStore(bucket="test-bucket")
    monkeypatch.setattr(store, "_client", lambda: fake_client)

    url = store.presigned_upload_url("job-1")

    assert url == "https://example.com/uploads/job-1.pdf?signed=1"
    operation, params, expires = fake_client.presign_calls[0]
    assert operation == "put_object"
    assert params["Bucket"] == "test-bucket"
    assert params["Key"] == "uploads/job-1.pdf"
    assert params["ContentType"] == "application/pdf"
    assert expires > 0


def test_write_and_read_status_round_trip(monkeypatch):
    fake_client = _FakeS3Client()
    store = S3JobStore(bucket="test-bucket")
    monkeypatch.setattr(store, "_client", lambda: fake_client)

    store.write_status("job-1", {"status": "done", "html": "<p>x</p>"})

    assert store.read_status("job-1") == {"status": "done", "html": "<p>x</p>"}
    bucket, key, body, content_type = fake_client.put_calls[0]
    assert bucket == "test-bucket"
    assert key == "results/job-1.json"
    assert json.loads(body) == {"status": "done", "html": "<p>x</p>"}
    assert content_type == "application/json"


def test_read_status_returns_none_when_missing(monkeypatch):
    fake_client = _FakeS3Client()
    store = S3JobStore(bucket="test-bucket")
    monkeypatch.setattr(store, "_client", lambda: fake_client)

    assert store.read_status("missing-job") is None


def test_fetch_uploaded_pdf_returns_bytes(monkeypatch):
    fake_client = _FakeS3Client()
    fake_client.objects["uploads/job-1.pdf"] = b"%PDF-1.4 dummy"
    store = S3JobStore(bucket="test-bucket")
    monkeypatch.setattr(store, "_client", lambda: fake_client)

    assert store.fetch_uploaded_pdf("job-1") == b"%PDF-1.4 dummy"


def test_get_job_store_returns_s3_job_store(monkeypatch):
    monkeypatch.setenv("RENDER_JOBS_BUCKET", "test-bucket")
    assert isinstance(get_job_store(), S3JobStore)
