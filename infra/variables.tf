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
  description = "Lambdaのタイムアウト（秒）。生成AI呼び出しの待ちを見込む"
  type        = number
  default     = 60
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
  description = "docling-service Lambdaのタイムアウト（秒）。初回はMLモデルのダウンロードが発生しうるため長めに取る（ADR-026）"
  type        = number
  default     = 120
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
  description = "Parameter Store（SecureString）で管理するAPIキーの環境変数名（ADR-017）"
  type        = list(string)
  default     = ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]
}

variable "use_mock_ai" {
  description = "LambdaのUSE_MOCK_AI環境変数。実AIを叩く本番はfalse（ADR-006）"
  type        = string
  default     = "false"
}

variable "waf_rate_limit" {
  description = "WAFのレートベースルール上限（5分あたり・IP単位のリクエスト数）"
  type        = number
  default     = 2000
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
