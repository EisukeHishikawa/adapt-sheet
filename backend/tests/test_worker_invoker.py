"""worker_invoker.py（render-worker Lambdaの非同期起動）のテスト。

実Lambdaは呼ばず、boto3クライアントをフェイクへ差し替えて合成イベントの配線のみを検証する。
LocalHttpWorkerInvoker（ローカル開発用）はhttpx.MockTransportで実ネットワークなしに検証する。
"""

import json
import threading
import time

import httpx
import pytest

from app.services.worker_invoker import (
    LambdaWorkerInvoker,
    LocalHttpWorkerInvoker,
    WorkerInvokerError,
    get_worker_invoker,
)


class _FakeLambdaClient:
    def __init__(self) -> None:
        self.invoke_calls: list[tuple] = []

    def invoke(self, FunctionName, InvocationType, Payload):
        self.invoke_calls.append((FunctionName, InvocationType, Payload))


def test_constructor_raises_when_function_name_unset(monkeypatch):
    monkeypatch.delenv("RENDER_WORKER_FUNCTION_NAME", raising=False)
    with pytest.raises(WorkerInvokerError):
        LambdaWorkerInvoker()


def test_invoke_sends_event_invocation_with_synthesized_apigw_event(monkeypatch):
    fake_client = _FakeLambdaClient()
    monkeypatch.setattr("boto3.client", lambda service: fake_client)
    invoker = LambdaWorkerInvoker(function_name="render-worker")

    invoker.invoke("/internal/render-jobs/process", {"job_id": "job-1", "engine": "hybrid"})

    assert len(fake_client.invoke_calls) == 1
    function_name, invocation_type, payload_bytes = fake_client.invoke_calls[0]
    assert function_name == "render-worker"
    # 非同期起動（呼び出し元は起動の受理だけを待ち、完了を待たない）。
    assert invocation_type == "Event"

    event = json.loads(payload_bytes)
    assert event["httpMethod"] == "POST"
    assert event["path"] == "/internal/render-jobs/process"
    assert json.loads(event["body"]) == {"job_id": "job-1", "engine": "hybrid"}


def test_get_worker_invoker_returns_lambda_worker_invoker(monkeypatch):
    monkeypatch.delenv("RENDER_WORKER_LOCAL_URL", raising=False)
    monkeypatch.setenv("RENDER_WORKER_FUNCTION_NAME", "render-worker")
    assert isinstance(get_worker_invoker(), LambdaWorkerInvoker)


def test_local_http_invoker_posts_body_as_json_to_base_url_plus_path():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        return httpx.Response(202)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    invoker = LocalHttpWorkerInvoker("http://localhost:8000", client=client)

    invoker._send("/internal/render-jobs/process", {"job_id": "job-1", "engine": "hybrid"})

    assert captured["method"] == "POST"
    assert captured["url"] == "http://localhost:8000/internal/render-jobs/process"
    assert captured["body"] == {"job_id": "job-1", "engine": "hybrid"}


def test_local_http_invoker_invoke_returns_without_waiting_for_response():
    # lambda:invoke（InvocationType=Event）と同じく、起動元は完了を待たずに戻る必要がある。
    release = threading.Event()

    def handler(request: httpx.Request) -> httpx.Response:
        release.wait(timeout=2)
        return httpx.Response(202)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    invoker = LocalHttpWorkerInvoker("http://localhost:8000", client=client)

    started = time.monotonic()
    invoker.invoke("/internal/render-jobs/process", {"job_id": "job-1"})
    elapsed = time.monotonic() - started

    assert elapsed < 0.5
    release.set()


def test_local_http_invoker_swallows_connection_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    invoker = LocalHttpWorkerInvoker("http://localhost:8000", client=client)

    invoker._send("/internal/render-jobs/process", {"job_id": "job-1"})  # 例外を投げない


def test_get_worker_invoker_returns_local_http_worker_invoker_when_local_url_set(monkeypatch):
    monkeypatch.delenv("RENDER_WORKER_FUNCTION_NAME", raising=False)
    monkeypatch.setenv("RENDER_WORKER_LOCAL_URL", "http://localhost:8000")

    assert isinstance(get_worker_invoker(), LocalHttpWorkerInvoker)
