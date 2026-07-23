variable "aws_region" {
  description = "リソースを作成するAWSリージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "project" {
  description = "リソース名の接頭辞に使うプロジェクト名"
  type        = string
  default     = "adapt-sheet"
}

variable "environment" {
  description = "環境名（prod/staging等）。SSMパス・リソース名に含める"
  type        = string
  default     = "prod"
}

variable "image_tag" {
  description = "Lambdaへデプロイするbackendコンテナイメージのタグ（ECR Privateへpush済みのもの）"
  type        = string
  default     = "latest"
}

variable "lambda_memory_size" {
  description = "Lambdaのメモリ割り当て（MB）。PDF処理に余裕を持たせる（ADR-005）"
  type        = number
  default     = 4096
}

variable "lambda_timeout" {
  description = "backend Lambdaのタイムアウト（秒）。API Gateway REST APIの統合タイムアウト上限が29秒で、それを超えた分のレスポンスは破棄されるため揃える"
  type        = number
  default     = 29
}

variable "docling_image_tag" {
  description = "Lambdaへデプロイするdocling-serviceコンテナイメージのタグ（ECR Privateへpush済みのもの）"
  type        = string
  default     = "latest"
}

variable "docling_lambda_memory_size" {
  description = "docling-service Lambdaのメモリ割り当て（MB）。torch等のML推論に余裕を持たせる（ADR-026）"
  type        = number
  default     = 6144
}

variable "docling_lambda_timeout" {
  description = "docling-service Lambdaのタイムアウト（秒）。backendは29秒で打ち切られるが、その時点で処理を止めても得るものがないため余裕を残す（ADR-026）"
  type        = number
  default     = 60
}

variable "docling_lambda_ephemeral_storage_size" {
  description = "docling-service Lambdaの/tmpサイズ（MB）。torch/HuggingFaceの実行時キャッシュ置き場（ADR-026）"
  type        = number
  default     = 2048
}

variable "pdf2htmlex_image_tag" {
  description = "Lambdaへデプロイするpdf2htmlex-serviceコンテナイメージのタグ（ECR Privateへpush済みのもの）"
  type        = string
  default     = "latest"
}

variable "pdf2htmlex_lambda_memory_size" {
  description = "pdf2htmlex-service Lambdaのメモリ割り当て（MB）（ADR-026）"
  type        = number
  default     = 2048
}

variable "pdf2htmlex_lambda_timeout" {
  description = "pdf2htmlex-service Lambdaのタイムアウト（秒）（ADR-026）"
  type        = number
  default     = 60
}

variable "secret_parameter_names" {
  description = "Parameter Store（SecureString）で管理する秘密情報の環境変数名（ADR-017）。backendのapp/secrets_loader.pyが読む名前と一致させる"
  type        = list(string)
  default = [
    "GEMINI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    # JWT検証鍵とDB接続文字列。Lambdaの環境変数（コンソールで平文表示される）ではなく
    # SecureStringから実行時に展開する。未投入だと本番が常に未ログイン扱いになる（ADR-018/019）。
    "SUPABASE_JWT_SECRET",
    "DATABASE_URL",
  ]
}

variable "supabase_jwt_jwks_url" {
  description = "SupabaseのJWKSエンドポイント（ES256のJWT Signing Keysを使う場合のみ設定。HS256ならParameter StoreのSUPABASE_JWT_SECRETを使うため空でよい）"
  type        = string
  default     = ""
}

variable "use_mock_ai" {
  description = "LambdaのUSE_MOCK_AI環境変数。実AIを叩く本番はfalse（ADR-006）"
  type        = string
  default     = "false"
}

variable "api_throttle_rate_limit" {
  description = "API Gatewayステージ全体（全メソッド合算）の定常リクエスト数上限（req/秒。ADR-027）"
  type        = number
  default     = 50
}

variable "api_throttle_burst_limit" {
  description = "API Gatewayステージ全体（全メソッド合算）のバースト上限（ADR-027）"
  type        = number
  default     = 100
}

variable "ecr_keep_last_images" {
  description = "ECR Privateに残す最新イメージ数（無料枠500MBの逼迫を抑えるためのライフサイクル）"
  type        = number
  default     = 5
}

variable "tags" {
  description = "全リソースへ付与する追加タグ"
  type        = map(string)
  default     = {}
}
