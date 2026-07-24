variable "name" {
  description = "バケット名・OAC名の接頭辞"
  type        = string
}

variable "api_origin_domain_name" {
  description = "同一オリジンで /api/* を配信するためのAPI Gatewayドメイン（<rest_api_id>.execute-api.<region>.amazonaws.com）"
  type        = string
}

variable "api_origin_path" {
  description = "API Gatewayのステージパス（例: /prod）。CloudFrontが転送時に前置するため、SPA側は /api/... の相対パスのままでよい"
  type        = string
}

variable "enable_access_logging" {
  description = "CloudFrontの標準アクセスログをS3へ出力するか（ADR-030）"
  type        = bool
  default     = true
}

variable "log_retention_in_days" {
  description = "CloudFrontアクセスログ（S3）の保持期間（日）。ライフサイクルで自動削除する"
  type        = number
  default     = 30
}
