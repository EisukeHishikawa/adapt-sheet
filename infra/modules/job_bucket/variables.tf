variable "name" {
  description = "バケット名の接頭辞"
  type        = string
}

variable "expiration_days" {
  description = "アップロード済みPDF・ジョブ結果を自動失効させるまでの日数"
  type        = number
  default     = 1
}

variable "allowed_origins" {
  description = "ブラウザから署名付きURLへ直接PUTするためのCORS許可オリジン（フロントのCloudFrontドメイン）"
  type        = list(string)
}
