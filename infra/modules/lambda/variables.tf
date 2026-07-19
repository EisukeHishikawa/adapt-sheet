variable "name" {
  description = "Lambda関数名（IAMロール名の接頭辞にも使う）"
  type        = string
}

variable "image_uri" {
  description = "ECR PrivateのコンテナイメージURI（<repo_url>:<tag>）"
  type        = string
}

variable "memory_size" {
  description = "メモリ割り当て（MB）"
  type        = number
  default     = 4096
}

variable "timeout" {
  description = "タイムアウト（秒）"
  type        = number
  default     = 60
}

variable "ssm_prefix" {
  description = "APIキーのParameter Storeパス接頭辞（SSM_PARAMETER_PREFIX）"
  type        = string
}

variable "ssm_parameter_arns" {
  description = "読み取りを許可するSecureStringパラメータのARN一覧"
  type        = list(string)
}

variable "use_mock_ai" {
  description = "USE_MOCK_AI環境変数の値"
  type        = string
  default     = "false"
}

variable "extra_env" {
  description = "追加のLambda環境変数（GEMINI_MODEL等、任意）"
  type        = map(string)
  default     = {}
}
