"""内部変換サービス（docling-service / pdf2htmlex-service）へHTTPで委譲する共通実装（ADR-013/016）。

Docling（torch等の大容量ML依存）とpdf2htmlEX（AGPL、特殊パッチ済みpoppler/libfontforgeに依存する
重量級ネイティブ依存）はいずれも専用コンテナへ分離しており、backendからはHTTP経由の`POST /convert`を
呼ぶだけという配線が共通する。サービスごとの違いは「表示名・環境変数名・既定URL」だけのため、
共通部分を本モジュールへ集約し、各クライアント（docling_client / pdf2htmlex_client）は差分のみを持つ。

Lambda本番では両サービスともIAM認証必須のLambda Function URLとして公開する（ADR-026）ため、
`_auth_env_var`で指定した環境変数が"aws_sigv4"のときだけAWS SigV4でリクエストに署名する。
未設定のローカル/pytestではdocker-compose内部DNS宛のプレーンなHTTPのままで、boto3/botocoreは
importされない（secrets_loader.pyと同じ、本番専用機能を開発の必須依存にしない方針）。
"""

from __future__ import annotations

import os
from typing import Optional, Protocol

import httpx

from app.services.pdf_common import PDFConversionError, first_page_only

# Lambda Function URLのSigV4署名で使うサービス名。API Gatewayではなく関数URLを直接叩くため
# 署名対象サービスは常に"lambda"になる（AWS公式のFunction URL署名仕様）。
_SIGV4_SERVICE_NAME = "lambda"
_DEFAULT_AWS_REGION = "ap-northeast-1"


class PDFHtmlExtractor(Protocol):
    """本番/テストで差し替え可能にするための共通インターフェース（ai_client.AIClientと同じ方針）。"""

    def convert_to_html(self, filename: str, content: bytes) -> str: ...

    def warmup(self) -> bool: ...


class RemoteHtmlExtractor:
    """変換サービスへHTTPでPDF→HTML変換を委譲する本番実装の基底（ADR-013/016/026）。

    サブクラスは表示名・環境変数名・既定URL・認証方式の環境変数名を定義する。
    """

    # サブクラスが定義する。_service_labelはエラー文言に載せる人間可読なサービス名。
    _service_label: str
    _env_var: str
    _default_url: str
    # このLambdaが値"aws_sigv4"を持つときのみSigV4署名する（未定義/他の値なら常に無署名。ADR-026）。
    _auth_env_var: str = ""

    def __init__(
        self, base_url: Optional[str] = None, client: Optional[httpx.Client] = None
    ) -> None:
        # テスト側がhttpx.MockTransportを注入したClientやカスタムURLへ差し替えられるよう引数で受ける。
        self._base_url = (
            base_url or os.environ.get(self._env_var, self._default_url)
        ).rstrip("/")
        self._client = client or httpx.Client()

    def convert_to_html(self, filename: str, content: bytes) -> str:
        # コンテナ起動直後の初回変換ではモデルのダウンロード（Doclingで実測60秒超）が発生しうるため、
        # 通常の推論時間（数秒〜十数秒）より大きめのタイムアウトを取る。
        # 署名対象の最終バイト列を確定させるため、送信前にRequestを構築してから必要に応じて署名する。
        request = self._client.build_request(
            "POST",
            f"{self._base_url}/convert",
            files={"file": (filename, first_page_only(content), "application/pdf")},
            timeout=120.0,
        )
        self._sign_if_required(request)

        try:
            response = self._client.send(request)
        except httpx.RequestError as exc:
            raise PDFConversionError(f"{self._service_label}への接続に失敗しました: {exc}") from exc

        if response.status_code != 200:
            raise PDFConversionError(
                f"PDFの解析に失敗しました（{self._service_label} status={response.status_code}）: "
                f"{_extract_detail(response)}"
            )

        return response.json()["html"]

    def warmup(self) -> bool:
        """`GET /health`を1回だけ叩き、Lambda実行環境を起こしておく（ADR-028）。

        画面表示のついでに投げる副次的な処理であり、失敗しても本来の描画には影響しないため、
        例外は送出せず成否をboolで返す。実行環境の起動を待つ必要はないので、変換時（120秒）より
        大幅に短いタイムアウトにして、コールドスタート中でもフロントを待たせ続けない。
        """
        request = self._client.build_request("GET", f"{self._base_url}/health", timeout=10.0)
        self._sign_if_required(request)

        try:
            return self._client.send(request).status_code == 200
        except (httpx.HTTPError, PDFConversionError):
            # PDFConversionErrorはAWS認証情報が無く署名できない場合（本番のみ）に上がる。
            return False

    def _sign_if_required(self, request: httpx.Request) -> None:
        if self._auth_env_var and os.environ.get(self._auth_env_var) == "aws_sigv4":
            # multipartボディはデフォルトでストリーミングのため、署名対象として読み切ってから使う。
            request.read()
            _sign_with_sigv4(request)


def _sign_with_sigv4(request: httpx.Request) -> None:
    """httpxのRequestにAWS SigV4署名ヘッダーを追加する（Lambda Function URL・AWS_IAM認証用）。

    署名対象ヘッダーをhost/content-typeのみに絞ることで、httpxが実際に送信する残りのヘッダー
    （content-length等）と署名内容がズレる余地をなくす。boto3/botocoreはここでのみ遅延importし、
    署名しないローカル/pytestではAWS認証情報を必須依存にしない（secrets_loader.pyと同じ方針）。
    """
    import boto3  # 遅延import: SigV4署名を実際に使うLambda本番でのみ必要
    from botocore.auth import SigV4Auth
    from botocore.awsrequest import AWSRequest

    credentials = boto3.Session().get_credentials()
    if credentials is None:
        raise PDFConversionError("AWS認証情報が見つからないため、SigV4署名を作成できませんでした")

    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or _DEFAULT_AWS_REGION

    # ボディの無いGET（/healthのウォームアップ）ではcontent-typeが存在しないため、
    # 実際に送られるヘッダーだけを署名対象に含める。
    signed_headers = {"host": request.url.host}
    if "content-type" in request.headers:
        signed_headers["content-type"] = request.headers["content-type"]

    aws_request = AWSRequest(
        method=request.method,
        url=str(request.url),
        data=request.content,
        headers=signed_headers,
    )
    SigV4Auth(credentials.get_frozen_credentials(), _SIGV4_SERVICE_NAME, region).add_auth(aws_request)

    # 署名で新たに付与されたヘッダーだけをhttpx側へ反映し、既存ヘッダーは一切書き換えない。
    for header in ("Authorization", "X-Amz-Date", "X-Amz-Security-Token", "X-Amz-Content-SHA256"):
        if header in aws_request.headers:
            request.headers[header] = aws_request.headers[header]


def _extract_detail(response: httpx.Response) -> str:
    # 各サービスはFastAPIのHTTPExceptionで{"detail": ...}を返すが、想定外の形式
    # （ネットワーク機器のエラーページ等）が返っても落ちないようフォールバックする。
    try:
        return str(response.json().get("detail", response.text))
    except ValueError:
        return response.text
