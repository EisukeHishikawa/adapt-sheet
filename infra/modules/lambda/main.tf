data "aws_region" "current" {}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = "${var.name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# CloudWatch Logsへの書き込み（構造化ログの収集先。ADR-011）。
resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# X-Rayへのセグメント送信。backend→docling/pdf2htmlexのFunction URL呼び出しが1本のトレースに
# つながり、どのサービスで時間を使ったかを追える（ADR-030）。
resource "aws_iam_role_policy_attachment" "xray" {
  count      = var.enable_xray ? 1 : 0
  role       = aws_iam_role.this.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

# APIキー取得のための最小権限。対象パラメータのGetと、SSM経由のKMS復号だけを許可する（ADR-017）。
# docling/pdf2htmlex Lambda（ssm_parameter_arns未指定）はAPIキーを扱わないため、この権限自体を持たない（ADR-026）。
data "aws_iam_policy_document" "ssm_read" {
  count = length(var.ssm_parameter_arns) > 0 ? 1 : 0

  statement {
    sid       = "ReadApiKeyParameters"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = var.ssm_parameter_arns
  }

  statement {
    sid     = "DecryptViaSsm"
    actions = ["kms:Decrypt"]
    # SecureStringはアカウント既定のaws/ssmキーで暗号化される。復号はSSM経由に限定する
    # （kms:ViaService条件）ことで、KMSキーARNを直接指定せずとも過剰権限を避ける。
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.name}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ssm_read" {
  count  = length(var.ssm_parameter_arns) > 0 ? 1 : 0
  name   = "${var.name}-ssm-read"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.ssm_read[0].json
}

# 内部専用サービス（docling/pdf2htmlex）のFunction URLをSigV4署名で呼び出すための呼び出し元権限
# （identity-based）。呼び出し先Lambdaの resource-based policy（下のfunction_url_invoke）と対になる（ADR-026）。
data "aws_iam_policy_document" "invoke_function_url" {
  count = length(var.invoke_function_url_arns) > 0 ? 1 : 0

  statement {
    actions   = ["lambda:InvokeFunctionUrl"]
    resources = var.invoke_function_url_arns
  }
}

resource "aws_iam_role_policy" "invoke_function_url" {
  count  = length(var.invoke_function_url_arns) > 0 ? 1 : 0
  name   = "${var.name}-invoke-function-url"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.invoke_function_url[0].json
}

# ロググループをTerraform管理下に置き、保持期間を明示する。Lambdaの暗黙作成に任せると
# 「無期限保持」かつdestroyでも残る。
resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_in_days
}

resource "aws_lambda_function" "this" {
  function_name = var.name
  role          = aws_iam_role.this.arn

  # コンテナイメージ（Dockerfile.lambda）で動かす。runtime/handlerは指定しない（ADR-017）。
  package_type = "Image"
  image_uri    = var.image_uri

  # pdf2htmlEXのベースイメージがx86_64のみの提供のため、3関数ともx86_64へ揃える（ADR-026）。
  # 開発機（Apple Silicon）でビルドする場合は`docker build --platform linux/amd64`が必須。
  architectures = ["x86_64"]

  memory_size = var.memory_size
  timeout     = var.timeout

  # コンテナ内は/tmp以外が読み取り専用のため、MLモデル等の実行時キャッシュ置き場として拡張する。
  ephemeral_storage {
    size = var.ephemeral_storage_size
  }

  tracing_config {
    mode = var.enable_xray ? "Active" : "PassThrough"
  }

  depends_on = [aws_cloudwatch_log_group.this]

  environment {
    variables = merge(
      # secrets_loaderがコールドスタート時にこの接頭辞でParameter Storeを引く（ADR-017）。
      # APIキーを扱わないdocling/pdf2htmlex Lambdaはssm_prefix未指定のため、この変数自体を設定しない。
      var.ssm_prefix != "" ? { SSM_PARAMETER_PREFIX = var.ssm_prefix } : {},
      var.use_mock_ai != "" ? { USE_MOCK_AI = var.use_mock_ai } : {},
      var.extra_env,
    )
  }
}

# 内部専用サービス（docling/pdf2htmlex）をAPI Gatewayを介さず直接HTTPで公開するためのFunction URL。
# AWS_IAM認証を必須にし、呼び出し元をfunction_url_invoker_role_arnsで指定したロールのみに限定する
# （backend Lambdaがhttpxリクエストへの手動SigV4署名で呼び出す。ADR-026）。
resource "aws_lambda_function_url" "this" {
  count              = var.create_function_url ? 1 : 0
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "AWS_IAM"
}

resource "aws_lambda_permission" "function_url_invoke" {
  for_each = var.create_function_url ? toset(var.function_url_invoker_role_arns) : toset([])

  statement_id           = "AllowFunctionUrlInvoke${substr(md5(each.value), 0, 8)}"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.this.function_name
  principal              = each.value
  function_url_auth_type = "AWS_IAM"
}
