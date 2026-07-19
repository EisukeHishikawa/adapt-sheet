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

# APIキー取得のための最小権限。対象パラメータのGetと、SSM経由のKMS復号だけを許可する（ADR-017）。
data "aws_iam_policy_document" "ssm_read" {
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
  name   = "${var.name}-ssm-read"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.ssm_read.json
}

resource "aws_lambda_function" "this" {
  function_name = var.name
  role          = aws_iam_role.this.arn

  # backendはコンテナイメージ（Dockerfile.lambda）で動かす。runtime/handlerは指定しない（ADR-017）。
  package_type = "Image"
  image_uri    = var.image_uri

  memory_size = var.memory_size
  timeout     = var.timeout

  environment {
    variables = merge({
      # secrets_loaderがコールドスタート時にこの接頭辞でParameter Storeを引く（ADR-017）。
      SSM_PARAMETER_PREFIX = var.ssm_prefix
      USE_MOCK_AI          = var.use_mock_ai
    }, var.extra_env)
  }
}
