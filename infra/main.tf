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
  # モデルはイメージへ焼き込むが、torch/HuggingFaceの実行時キャッシュ書き込み先が/tmpのため
  # 既定512MBでは足りない（Dockerfile.lambdaのHF_HOME等を参照）。
  ephemeral_storage_size = var.docling_lambda_ephemeral_storage_size

  create_function_url            = true
  function_url_invoker_role_arns = [module.lambda.role_arn]

  log_retention_in_days = var.log_retention_in_days
  enable_xray           = var.enable_xray
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

  log_retention_in_days = var.log_retention_in_days
  enable_xray           = var.enable_xray
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

  log_retention_in_days = var.log_retention_in_days
  enable_xray           = var.enable_xray

  invoke_function_url_arns = [module.lambda_docling.function_arn, module.lambda_pdf2htmlex.function_arn]
  extra_env = merge(
    {
      # remote_extractor.pyがこのURL宛にPOSTし、*_AUTH=aws_sigv4でSigV4署名を有効化する（ADR-026）。
      DOCLING_SERVICE_URL     = module.lambda_docling.function_url
      DOCLING_SERVICE_AUTH    = "aws_sigv4"
      PDF2HTMLEX_SERVICE_URL  = module.lambda_pdf2htmlex.function_url
      PDF2HTMLEX_SERVICE_AUTH = "aws_sigv4"
    },
    # SupabaseがJWT Signing Keys（ES256）を使う場合の公開鍵配布URL。公開情報のため
    # SecureStringではなく環境変数で渡す。HS256共有シークレット方式なら未設定のままでよく、
    # その場合はSUPABASE_JWT_SECRET（Parameter Store）側が使われる（ADR-018/020）。
    var.supabase_jwt_jwks_url != "" ? { SUPABASE_JWT_JWKS_URL = var.supabase_jwt_jwks_url } : {},
  )
}

# 公開エンドポイント。REST API（REGIONAL）でLambdaへプロキシし、ステージ全体のスロットリングで
# 過度なAPIコールを防ぐ（WAFを使わない代替。ADR-027）。
module "api" {
  source                = "./modules/api_gateway"
  name                  = "${local.name_prefix}-api"
  lambda_invoke_arn     = module.lambda.invoke_arn
  lambda_function_name  = module.lambda.function_name
  throttle_rate_limit   = var.api_throttle_rate_limit
  throttle_burst_limit  = var.api_throttle_burst_limit
  log_retention_in_days = var.log_retention_in_days
  enable_xray           = var.enable_xray
}

# フロントエンド配信（S3非公開＋CloudFront OAC）。/api/* は同じCloudFrontからAPI Gatewayへ
# 転送し、SPAとAPIを同一オリジンに揃える（フロントは相対パスで/api/...を叩くため）。
module "frontend" {
  source                 = "./modules/frontend"
  name                   = local.name_prefix
  api_origin_domain_name = module.api.origin_domain_name
  api_origin_path        = module.api.origin_path
  enable_access_logging  = var.enable_cloudfront_access_logging
  log_retention_in_days  = var.log_retention_in_days
}

# ログを取るだけでは障害に気づけないため、アラームとその通知先までをコード化する（ADR-030）。
module "monitoring" {
  source = "./modules/monitoring"
  name   = local.name_prefix

  alarm_email = var.alarm_email

  lambda_function_names = [
    module.lambda.function_name,
    module.lambda_docling.function_name,
    module.lambda_pdf2htmlex.function_name,
  ]

  api_name       = "${local.name_prefix}-api"
  api_stage_name = module.api.stage_name

  backend_log_group_name = module.lambda.log_group_name
}
