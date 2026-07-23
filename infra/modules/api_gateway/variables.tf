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
