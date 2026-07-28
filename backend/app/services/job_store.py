"""非同期レンダリングジョブ（アップロード済みPDF・結果）のS3を使った読み書き。

生成AIエンジン（gemini_free/gemini/claude/openai/hybrid）はAPI Gatewayの統合タイムアウト
（29秒固定）に収まらないことがあるため、実処理をrender-worker Lambdaへ非同期起動する
（app/services/worker_invoker.py）。本モジュールはbackend/render-worker間の受け渡しに使う
S3バケット（uploads/{job_id}.pdf・results/{job_id}.json）を扱う。

RENDER_JOBS_BUCKET未設定のローカル/pytestでは想定利用者（POST /api/render/jobs等）が
無いため、S3JobStoreの構築時点で例外を送出する（remote_extractor.py等と同じ
「本番専用機能はモジュールスコープでboto3を遅延import」方針を踏襲する）。

エンドポイントはRENDER_JOBS_S3_ENDPOINT_URL/RENDER_JOBS_S3_PUBLIC_ENDPOINT_URLで
上書きできる。ローカル開発（docker-compose.yml）ではS3互換のMinIOを指すが、これは設定値の
違いに過ぎずクラスを分けない。未設定時（本番）は従来どおり実AWS S3のリージョナルエンドポイントを
使うため、本番の挙動はこの変更の前後で変わらない。
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
    """RENDER_JOBS_BUCKET環境変数で指定されたバケットを使う。エンドポイントは
    RENDER_JOBS_S3_ENDPOINT_URL（内部通信用）/RENDER_JOBS_S3_PUBLIC_ENDPOINT_URL
    （presigned URLの発行先。ブラウザから到達できるホストである必要がある）で上書き可能。
    いずれも未設定時は実AWS S3のリージョナルエンドポイントを両方に使う（本番の既定動作）。
    """

    def __init__(
        self,
        bucket: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        public_endpoint_url: Optional[str] = None,
    ) -> None:
        self._bucket = bucket or os.environ.get("RENDER_JOBS_BUCKET", "").strip()
        if not self._bucket:
            raise JobStoreError("RENDER_JOBS_BUCKET is not set")

        self._region = os.environ.get("AWS_REGION", "ap-northeast-1")
        default_endpoint = f"https://s3.{self._region}.amazonaws.com"
        self._endpoint_url = (
            endpoint_url or os.environ.get("RENDER_JOBS_S3_ENDPOINT_URL", "").strip() or default_endpoint
        )
        self._public_endpoint_url = (
            public_endpoint_url
            or os.environ.get("RENDER_JOBS_S3_PUBLIC_ENDPOINT_URL", "").strip()
            or self._endpoint_url
        )
        # MinIO等のS3互換サーバーはバケット名をサブドメインへ含めるvirtual-hosted-style
        # アドレッシングに対応しないため、エンドポイントが上書きされている場合はpath-styleを使う。
        self._use_path_style = self._endpoint_url != default_endpoint

    def new_job_id(self) -> str:
        return str(uuid.uuid4())

    def presigned_upload_url(self, job_id: str) -> str:
        return self._presign_client().generate_presigned_url(
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
        """backend/render-worker自身がオブジェクトを読み書きする際に使う内部向けクライアント。"""
        return self._build_client(self._endpoint_url)

    def _presign_client(self):
        """presigned URLの署名専用クライアント。ネットワーク接続は発生せず、URLへ埋め込む
        ホスト名（ブラウザから到達できる必要がある）を決めるためだけに使う。"""
        return self._build_client(self._public_endpoint_url)

    def _build_client(self, endpoint_url: str):
        import boto3  # 遅延import: 本番のみ必要（secrets_loader.py等と同じ方針）

        # region_nameのみ指定するとgenerate_presigned_urlは既定でグローバルエンドポイント
        # （s3.amazonaws.com）のURLを生成し、実際のアクセス時にリージョナルエンドポイントへの
        # 307リダイレクトが発生する。ブラウザのfetchはこのクロスオリジンリダイレクトを
        # 正しく扱えずCORSエラーになるため、endpoint_urlを明示してリダイレクト自体を無くす。
        kwargs = {"region_name": self._region, "endpoint_url": endpoint_url}
        if self._use_path_style:
            from botocore.config import Config

            kwargs["config"] = Config(s3={"addressing_style": "path"})
        return boto3.client("s3", **kwargs)

    @staticmethod
    def _upload_key(job_id: str) -> str:
        return f"uploads/{job_id}.pdf"

    @staticmethod
    def _status_key(job_id: str) -> str:
        return f"results/{job_id}.json"


def get_job_store() -> JobStore:
    """FastAPIのDependsとして利用するファクトリ。テスト側はdependency_overridesで差し替える。"""
    return S3JobStore()
