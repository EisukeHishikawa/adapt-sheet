variable "repository_name" {
  description = "ECR Privateリポジトリ名"
  type        = string
}

variable "keep_last_images" {
  description = "ライフサイクルで保持する最新イメージ数"
  type        = number
  default     = 5
}
