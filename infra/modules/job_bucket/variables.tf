variable "name" {
  description = "バケット名の接頭辞"
  type        = string
}

variable "expiration_days" {
  description = "アップロード済みPDF・ジョブ結果を自動失効させるまでの日数"
  type        = number
  default     = 1
}
