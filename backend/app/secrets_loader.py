"""Parameter Store からのAPIキー読み込み（ADR-017）。

AWS Lambda のコールドスタート時（＝このモジュールを import するグローバルスコープ）に一度だけ
Parameter Store を呼び出し、取得したAPIキーを os.environ へ展開する。これにより、リクエストを
処理するハンドラの中では毎回SSMを叩かず os.getenv で読むだけになり、Lambdaの実行時間課金と
SSMのレート制限（GetParameters）の双方を回避する。

APIキーはDockerイメージにもコードにもハードコードせずSecureStringパラメータとして保管し、
実行時に復号取得する（CLAUDE.md セキュリティ）。SSM_PARAMETER_PREFIX が未設定のローカル/pytestでは
何もしない（no-op）ため、開発時に boto3 やAWS認証情報を必要としない。
"""

from __future__ import annotations

import logging
import os
from typing import Callable, Optional

logger = logging.getLogger("app.secrets")

# Parameter Store から取得して os.environ へ展開する環境変数名。いずれも実行時にのみ必要な
# 秘密情報であり、イメージには一切含めない。既に env に存在するものは取得対象から外す
# （ローカルの .env 等で明示設定した値を尊重し、SSM呼び出しも省く）。
_SECRET_ENV_NAMES = ("GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY")


def load_secrets_into_env(ssm_client_factory: Optional[Callable[[], object]] = None) -> None:
    """Parameter Store のAPIキーを os.environ へ展開する（コールドスタート時に一度だけ呼ぶ）。

    冪等性は「既に env にあるキーは取得対象から外す」ことで担保する。初回はキーが無いので
    SSMから取得して env へ書き込み、以降の呼び出しは対象が空になりSSMへ到達する前に return する。
    そのため呼び出し側でフラグ管理をしなくても二重取得は起きない。

    ssm_client_factory はテストがフェイクを注入するための口。本番は None のまま boto3 を遅延
    import して用いるため、boto3 をローカル/pytestの必須依存にしない。
    """
    prefix = os.getenv("SSM_PARAMETER_PREFIX", "").strip()
    if not prefix:
        return

    names = [name for name in _SECRET_ENV_NAMES if not os.getenv(name)]
    if not names:
        return

    if ssm_client_factory is None:
        import boto3  # 遅延import: SSMを実際に使うLambda/本番でのみ必要

        ssm_client_factory = lambda: boto3.client("ssm")  # noqa: E731

    ssm = ssm_client_factory()
    paths = [f"{prefix.rstrip('/')}/{name}" for name in names]
    response = ssm.get_parameters(Names=paths, WithDecryption=True)

    resolved = {
        param["Name"].rsplit("/", 1)[-1]: param["Value"] for param in response.get("Parameters", [])
    }
    for name in names:
        value = resolved.get(name)
        if value:
            os.environ[name] = value
            # 値そのものは機微情報のためログへ出さない（ADR-011）。取得できた事実のみ残す。
            logger.info("Parameter Storeからキーを読み込みました", extra={"secret_name": name})

    for invalid in response.get("InvalidParameters", []):
        logger.warning("Parameter Storeに未登録のパラメータです", extra={"parameter": invalid})
