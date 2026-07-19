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
