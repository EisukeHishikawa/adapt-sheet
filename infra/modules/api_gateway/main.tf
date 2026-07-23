data "aws_region" "current" {}

resource "aws_api_gateway_rest_api" "this" {
  name = var.name

  # 未指定だとREST APIがリクエストボディをUTF-8テキストとして扱い、PDFのmultipart/form-dataが
  # 破壊される。"*/*"を指定するとバイナリとみなしてbase64化＋isBase64Encoded=trueで渡すため、
  # Lambda Web Adapterが元のバイト列へ復元できる。
  binary_media_types = ["*/*"]

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# 全パス・全メソッドをLambdaへ委譲する（Lambda Web Adapter側でルーティングする）。
resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = aws_api_gateway_rest_api.this.root_resource_id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.proxy.id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.proxy.id
  http_method = aws_api_gateway_method.proxy.http_method

  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = var.lambda_invoke_arn
}

# ルートパス "/" もLambdaへ委譲する（{proxy+}はルートを含まないため個別に定義）。
resource "aws_api_gateway_method" "root" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_rest_api.this.root_resource_id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "root" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_rest_api.this.root_resource_id
  http_method = aws_api_gateway_method.root.http_method

  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = var.lambda_invoke_arn
}

resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  # メソッド/統合の変更時に再デプロイを促す。
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.proxy.id,
      aws_api_gateway_method.proxy.id,
      aws_api_gateway_integration.proxy.id,
      aws_api_gateway_method.root.id,
      aws_api_gateway_integration.root.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.proxy,
    aws_api_gateway_integration.root,
  ]
}

# API Gatewayがアカウント単位で1つだけ持つCloudWatch Logs書き込みロール。これが無いと
# ステージのアクセスログ設定自体が受け付けられない（AWS側の仕様）。
resource "aws_iam_role" "cloudwatch" {
  name = "${var.name}-apigw-cloudwatch"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "apigateway.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cloudwatch" {
  role       = aws_iam_role.cloudwatch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

resource "aws_api_gateway_account" "this" {
  cloudwatch_role_arn = aws_iam_role.cloudwatch.arn
  depends_on          = [aws_iam_role_policy_attachment.cloudwatch]
}

# アクセスログの保存先。Lambdaのロググループ（ADR-011）と同様にTerraform管理下へ置き、
# 保持期間を明示する。暗黙作成に任せると無期限保持になる。
resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}/access"
  retention_in_days = var.log_retention_in_days
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.stage_name

  # backend側のLambdaログ（ADR-011）と同じくJSON1行で出す。429のようにLambdaへ到達せず
  # API Gatewayで打ち切られたリクエスト（ADR-027のスロットリング）は、ここにしか記録が残らない。
  # backendのログとの突き合わせはxrayTraceId（LambdaへX-Amzn-Trace-Idとして渡る）で行う。
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestTime        = "$context.requestTime"
      requestId          = "$context.requestId"
      httpMethod         = "$context.httpMethod"
      path               = "$context.path"
      status             = "$context.status"
      protocol           = "$context.protocol"
      responseLength     = "$context.responseLength"
      responseLatency    = "$context.responseLatency"
      integrationStatus  = "$context.integration.status"
      integrationLatency = "$context.integration.latency"
      integrationError   = "$context.integration.error"
      sourceIp           = "$context.identity.sourceIp"
      userAgent          = "$context.identity.userAgent"
      errorMessage       = "$context.error.message"
      errorResponseType  = "$context.error.responseType"
      xrayTraceId        = "$context.xrayTraceId"
    })
  }

  xray_tracing_enabled = var.enable_xray

  depends_on = [aws_api_gateway_account.this]
}

# ステージ全体（全メソッド合算）のリクエスト数を制限する（WAFを使わない代替。ADR-027）。
# API Gatewayのスロットリングはクライアント（IP等）を区別せず合算でカウントするため、
# WAFのレートベースルールと異なり1クライアントの連打が他の利用者にも影響しうる。
resource "aws_api_gateway_method_settings" "default" {
  rest_api_id = aws_api_gateway_rest_api.this.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  method_path = "*/*"

  settings {
    throttling_rate_limit  = var.throttle_rate_limit
    throttling_burst_limit = var.throttle_burst_limit

    # CloudWatchメトリクス（4XXError/5XXError/Latency等）を有効化する。アラーム
    # （modules/monitoring）はこれが無いと発報しない。
    metrics_enabled = true

    # 実行ログはエラー時のみ。data_trace_enabledはリクエスト/レスポンスの本文まで
    # ロググループへ書き出すため、業務データ・PDFが漏れる。本番では絶対に有効化しない（ADR-030）。
    logging_level      = var.execution_logging_level
    data_trace_enabled = false
  }

  depends_on = [aws_api_gateway_account.this]
}

# API GatewayからのLambda呼び出しを許可する。
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}
