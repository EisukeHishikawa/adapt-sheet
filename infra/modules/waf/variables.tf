variable "name" {
  description = "Web ACL名・メトリクス名の接頭辞"
  type        = string
}

variable "resource_arn" {
  description = "Web ACLを関連付ける対象のARN（API GatewayステージARN）"
  type        = string
}

variable "rate_limit" {
  description = "レートベースルールの上限（5分あたり・IP単位）"
  type        = number
  default     = 2000
}
