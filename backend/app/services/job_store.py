"""非同期レンダリングジョブ（アップロード済みPDF・結果）のS3を使った読み書き。

生成AIエンジン（gemini_free/gemini/claude/openai/hybrid）はAPI Gatewayの統合タイムアウト
（29秒固定）に収まらないことがあるため、実処理をrender-worker Lambdaへ非同期起動する
（app/services/worker_invoker.py）。本モジュールはbackend/render-worker間の受け渡しに使う
S3バケット（uploads/{job_id}.pdf・results/{job_id}.json）を扱う。

RENDER_JOBS_BUCKET未設定のローカル/pytestでは想定利用者（POST /api/render/jobs等）が
無いため、S3JobStoreの構築時点で例外を送出する（remote_extractor.py等と同じ
「本番専用機能はモジュールスコープでboto3を遅延import」方針を踏襲する）。
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Optional, Protocol

_UPLOAD_URL_EXPIRES_SECONDS = 300


class JobStoreError(Exception):
    """ジョブストア（S3）関連の失敗。"""


class JobStore(Protocol):
    """テスト側がdependency_overridesでフェイクへ差し替えるための共通インターフェース。"""

    def new_job_id(self) -> str: ...

    def presigned_upload_url(self, job_id: str) -> str: ...

    def fetch_uploaded_pdf(self, job_id: str) -> bytes: ...

    def write_status(self, job_id: str, payload: dict) -> None: ...

    def read_status(self, job_id: str) -> Optional[dict]: ...


class S3JobStore:
    """本番用実装。RENDER_JOBS_BUCKET環境変数で指定されたバケットを使う。"""

    def __init__(self, bucket: Optional[str] = None) -> None:
        self._bucket = bucket or os.environ.get("RENDER_JOBS_BUCKET", "").strip()
        if not self._bucket:
            raise JobStoreError("RENDER_JOBS_BUCKET is not set")

    def new_job_id(self) -> str:
        return str(uuid.uuid4())

    def presigned_upload_url(self, job_id: str) -> str:
        return self._client().generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._bucket,
                "Key": self._upload_key(job_id),
                "ContentType": "application/pdf",
            },
            ExpiresIn=_UPLOAD_URL_EXPIRES_SECONDS,
        )

    def fetch_uploaded_pdf(self, job_id: str) -> bytes:
        obj = self._client().get_object(Bucket=self._bucket, Key=self._upload_key(job_id))
        return obj["Body"].read()

    def write_status(self, job_id: str, payload: dict) -> None:
        self._client().put_object(
            Bucket=self._bucket,
            Key=self._status_key(job_id),
            Body=json.dumps(payload).encode("utf-8"),
            ContentType="application/json",
        )

    def read_status(self, job_id: str) -> Optional[dict]:
        client = self._client()
        try:
            obj = client.get_object(Bucket=self._bucket, Key=self._status_key(job_id))
        except client.exceptions.NoSuchKey:
            return None
        return json.loads(obj["Body"].read())

    def _client(self):
        import boto3  # 遅延import: 本番のみ必要（secrets_loader.py等と同じ方針）

        # region_nameのみ指定するとgenerate_presigned_urlは既定でグローバルエンドポイント
        # （s3.amazonaws.com）のURLを生成し、実際のアクセス時にリージョナルエンドポイントへの
        # 307リダイレクトが発生する。ブラウザのfetchはこのクロスオリジンリダイレクトを
        # 正しく扱えずCORSエラーになるため、endpoint_urlを明示してリダイレクト自体を無くす。
        region = os.environ.get("AWS_REGION", "ap-northeast-1")
        return boto3.client("s3", region_name=region, endpoint_url=f"https://s3.{region}.amazonaws.com")

    @staticmethod
    def _upload_key(job_id: str) -> str:
        return f"uploads/{job_id}.pdf"

    @staticmethod
    def _status_key(job_id: str) -> str:
        return f"results/{job_id}.json"


def get_job_store() -> JobStore:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return S3JobStore()
