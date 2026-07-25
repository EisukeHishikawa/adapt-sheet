variable "name" {
  description = "リソース名の接頭辞。IAMの権限範囲もこの接頭辞で始まる名前に限定する"
  type        = string
}

variable "github_repository" {
  description = "デプロイを許可するGitHubリポジトリ（owner/repo形式）"
  type        = string
}

variable "allowed_refs" {
  description = "デプロイを許可するGitHubのref。ここに含まれないブランチのワークフローはロールを引き受けられない"
  type        = list(string)
  default     = ["refs/heads/main"]
}

variable "create_oidc_provider" {
  description = "GitHubのOIDCプロバイダをこのTerraformで作成するか。アカウントに既存のものがある場合はfalseにして既存を参照する（IAM OIDCプロバイダはアカウントに1つしか作れない）"
  type        = bool
  default     = true
}

variable "state_bucket_name" {
  description = "Terraform stateを保存するS3バケット名（infra/bootstrapで作成したもの）"
  type        = string

  validation {
    condition     = length(var.state_bucket_name) > 0
    error_message = "state_bucket_name は必須。infra/bootstrap の出力値を terraform.tfvars に設定する。"
  }
}

variable "lock_table_name" {
  description = "stateロック用DynamoDBテーブル名（infra/bootstrapで作成したもの）"
  type        = string
}
