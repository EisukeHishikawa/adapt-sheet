variable "aws_region" {
  description = "state用リソースを作成するリージョン（本体と揃える）"
  type        = string
  default     = "ap-northeast-1"
}

variable "state_bucket_name" {
  description = "Terraform stateを保存するS3バケット名（グローバル一意。例: adapt-sheet-tfstate-<account_id>）"
  type        = string
}

variable "lock_table_name" {
  description = "stateロック用DynamoDBテーブル名"
  type        = string
  default     = "adapt-sheet-tflock"
}
