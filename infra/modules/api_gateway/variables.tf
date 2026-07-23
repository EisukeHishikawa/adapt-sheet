variable "name" {
  description = "REST API名"
  type        = string
}

variable "lambda_invoke_arn" {
  description = "統合先Lambdaの invoke_arn"
  type        = string
}

variable "lambda_function_name" {
  description = "呼び出しを許可するLambda関数名"
  type        = string
}

variable "stage_name" {
  description = "デプロイするステージ名"
  type        = string
  default     = "prod"
}

variable "throttle_rate_limit" {
  description = "ステージ全体（全メソッド合算）の定常リクエスト数上限（req/秒）"
  type        = number
  default     = 50
}

variable "throttle_burst_limit" {
  description = "ステージ全体（全メソッド合算）のバースト上限（同時トークンバケット容量）"
  type        = number
  default     = 100
}

variable "log_retention_in_days" {
  description = "アクセスログ（CloudWatch Logs）の保持期間（日）（ADR-030）"
  type        = number
  default     = 30
}

variable "execution_logging_level" {
  description = "API Gateway実行ログの出力レベル（OFF/ERROR/INFO）。INFOは冗長なためERROR既定（ADR-030）"
  type        = string
  default     = "ERROR"

  validation {
    condition     = contains(["OFF", "ERROR", "INFO"], var.execution_logging_level)
    error_message = "execution_logging_levelはOFF/ERROR/INFOのいずれかを指定してください。"
  }
}

variable "enable_xray" {
  description = "ステージでX-Rayのトレースを有効にするか（ADR-030）"
  type        = bool
  default     = true
}
