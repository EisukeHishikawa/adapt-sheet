"""worker_invoker.py（render-worker Lambdaの非同期起動）のテスト。

実Lambdaは呼ばず、boto3クライアントをフェイクへ差し替えて合成イベントの配線のみを検証する。
"""

import json

import pytest

from app.services.worker_invoker import (
    LambdaWorkerInvoker,
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
    monkeypatch.setenv("RENDER_WORKER_FUNCTION_NAME", "render-worker")
    assert isinstance(get_worker_invoker(), LambdaWorkerInvoker)
