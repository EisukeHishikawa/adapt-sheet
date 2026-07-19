locals {
  name_prefix = "${var.project}-${var.environment}"
  # APIキーのParameter Storeパス接頭辞。backend（app/secrets_loader.py）がSSM_PARAMETER_PREFIXとして
  # 受け取り、コールドスタート時に "{prefix}/GEMINI_API_KEY" 等を復号取得する（ADR-017）。
  ssm_prefix = "/${var.project}/${var.environment}"

  tags = merge({
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }, var.tags)
}

# Lambdaのコンテナイメージ置き場。Lambdaは同一リージョンのECR Privateからのみイメージを取得できる
# ため、ECR Publicではなく Private を用いる（ADR-017）。
module "ecr" {
  source           = "./modules/ecr"
  repository_name  = "${local.name_prefix}-backend"
  keep_last_images = var.ecr_keep_last_images
}

# APIキーの入れ物（SecureString）。値はTerraform管理外で投入し、コミットしない（ADR-017）。
module "ssm" {
  source       = "./modules/ssm"
  prefix       = local.ssm_prefix
  secret_names = var.secret_parameter_names
}

# 入口エンドポイント（backend）のLambda。実行ロールにSSM読み取り＋KMS復号のみを最小権限で付与する。
module "lambda" {
  source             = "./modules/lambda"
  name               = "${local.name_prefix}-backend"
  image_uri          = "${module.ecr.repository_url}:${var.image_tag}"
  memory_size        = var.lambda_memory_size
  timeout            = var.lambda_timeout
  ssm_prefix         = local.ssm_prefix
  ssm_parameter_arns = module.ssm.parameter_arns
  use_mock_ai        = var.use_mock_ai
}

# 公開エンドポイント。WAFを前段に付けられるようREST API（REGIONAL）でLambdaへプロキシする。
module "api" {
  source               = "./modules/api_gateway"
  name                 = "${local.name_prefix}-api"
  lambda_invoke_arn    = module.lambda.invoke_arn
  lambda_function_name = module.lambda.function_name
}

# APIの前段のWAF（AWSマネージドルール＋レート制限）。REST APIのステージへ関連付ける。
module "waf" {
  source       = "./modules/waf"
  name         = local.name_prefix
  resource_arn = module.api.stage_arn
  rate_limit   = var.waf_rate_limit
}

# フロントエンド配信（S3非公開＋CloudFront OAC）。
module "frontend" {
  source = "./modules/frontend"
  name   = local.name_prefix
}
