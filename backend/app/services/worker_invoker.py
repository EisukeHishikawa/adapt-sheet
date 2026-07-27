"""render-worker Lambdaの非同期起動（lambda:invoke, InvocationType=Event）。

render-workerはbackendと同じイメージ（AWS Lambda Web Adapter + FastAPI）を使い回し、
API Gateway/Function URLを経由せず直接lambda:invokeで起動する。Web AdapterはAPI Gateway
REST API（v1プロキシ統合）形式のイベントをHTTP呼び出しへ変換するため、合成イベントを
その形式に合わせて組み立てる（infra/main.tfのAWS_PROXY統合が本番で実際に渡す形と揃える）。

RENDER_WORKER_FUNCTION_NAME未設定のローカル/pytestでは想定利用者が無いため、
LambdaWorkerInvokerの構築時点で例外を送出する（job_store.pyと同じ方針）。
"""

from __future__ import annotations

import json
import os
from typing import Optional, Protocol


class WorkerInvokerError(Exception):
    """render-worker起動関連の失敗。"""


class WorkerInvoker(Protocol):
    """テスト側がdependency_overridesでフェイクへ差し替えるための共通インターフェース。"""

    def invoke(self, path: str, body: dict) -> None: ...


class LambdaWorkerInvoker:
    """本番用実装。RENDER_WORKER_FUNCTION_NAME環境変数で指定された関数を起動する。"""

    def __init__(self, function_name: Optional[str] = None) -> None:
        self._function_name = function_name or os.environ.get(
            "RENDER_WORKER_FUNCTION_NAME", ""
        ).strip()
        if not self._function_name:
            raise WorkerInvokerError("RENDER_WORKER_FUNCTION_NAME is not set")

    def invoke(self, path: str, body: dict) -> None:
        import boto3  # 遅延import: 本番のみ必要（secrets_loader.py等と同じ方針）

        client = boto3.client("lambda")
        client.invoke(
            FunctionName=self._function_name,
            InvocationType="Event",
            Payload=json.dumps(_build_apigw_event(path, body)).encode("utf-8"),
        )


def _build_apigw_event(path: str, body: dict) -> dict:
    """AWS Lambda Web AdapterがHTTPリクエストへ変換できる、API Gateway REST API
    （v1プロキシ統合）相当の最小イベントを組み立てる。
    """
    return {
        "resource": "/{proxy+}",
        "path": path,
        "httpMethod": "POST",
        "headers": {"Content-Type": "application/json"},
        "multiValueHeaders": {"Content-Type": ["application/json"]},
        "queryStringParameters": None,
        "multiValueQueryStringParameters": None,
        "pathParameters": {"proxy": path.lstrip("/")},
        "stageVariables": None,
        "requestContext": {
            "resourcePath": "/{proxy+}",
            "httpMethod": "POST",
            "path": path,
            "stage": "internal",
            "identity": {"sourceIp": "127.0.0.1"},
            "protocol": "HTTP/1.1",
        },
        "body": json.dumps(body),
        "isBase64Encoded": False,
    }


def get_worker_invoker() -> WorkerInvoker:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return LambdaWorkerInvoker()
