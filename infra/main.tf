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

# Doclingサービス（テキスト抽出）のLambda化（ADR-026）。backend以外からは呼ばれない内部専用サービス
# のため、API Gatewayではなく AWS_IAM 認証必須の Function URL を直接公開し、backend Lambdaの実行ロール
# のみに呼び出しを許可する。APIキーを扱わないため ssm_prefix/ssm_parameter_arns は渡さない。
module "ecr_docling" {
  source           = "./modules/ecr"
  repository_name  = "${local.name_prefix}-docling"
  keep_last_images = var.ecr_keep_last_images
}

module "lambda_docling" {
  source      = "./modules/lambda"
  name        = "${local.name_prefix}-docling"
  image_uri   = "${module.ecr_docling.repository_url}:${var.docling_image_tag}"
  memory_size = var.docling_lambda_memory_size
  timeout     = var.docling_lambda_timeout

  create_function_url            = true
  function_url_invoker_role_arns = [module.lambda.role_arn]
}

# pdf2htmlEXサービス（PDF→HTML変換）のLambda化（ADR-026）。設計はdocling-serviceと同じ。
module "ecr_pdf2htmlex" {
  source           = "./modules/ecr"
  repository_name  = "${local.name_prefix}-pdf2htmlex"
  keep_last_images = var.ecr_keep_last_images
}

module "lambda_pdf2htmlex" {
  source      = "./modules/lambda"
  name        = "${local.name_prefix}-pdf2htmlex"
  image_uri   = "${module.ecr_pdf2htmlex.repository_url}:${var.pdf2htmlex_image_tag}"
  memory_size = var.pdf2htmlex_lambda_memory_size
  timeout     = var.pdf2htmlex_lambda_timeout

  create_function_url            = true
  function_url_invoker_role_arns = [module.lambda.role_arn]
}

# 入口エンドポイント（backend）のLambda。実行ロールにSSM読み取り＋KMS復号に加え、docling/pdf2htmlexの
# Function URL呼び出し権限（identity-based）を最小権限で付与する。resource-based側の許可は上記
# function_url_invoker_role_arnsが担う（ADR-026）。
module "lambda" {
  source             = "./modules/lambda"
  name               = "${local.name_prefix}-backend"
  image_uri          = "${module.ecr.repository_url}:${var.image_tag}"
  memory_size        = var.lambda_memory_size
  timeout            = var.lambda_timeout
  ssm_prefix         = local.ssm_prefix
  ssm_parameter_arns = module.ssm.parameter_arns
  use_mock_ai        = var.use_mock_ai

  invoke_function_url_arns = [module.lambda_docling.function_arn, module.lambda_pdf2htmlex.function_arn]
  extra_env = {
    # remote_extractor.pyがこのURL宛にPOSTし、*_AUTH=aws_sigv4でSigV4署名を有効化する（ADR-026）。
    DOCLING_SERVICE_URL     = module.lambda_docling.function_url
    DOCLING_SERVICE_AUTH    = "aws_sigv4"
    PDF2HTMLEX_SERVICE_URL  = module.lambda_pdf2htmlex.function_url
    PDF2HTMLEX_SERVICE_AUTH = "aws_sigv4"
  }
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
