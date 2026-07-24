variable "name" {
  description = "SNSトピック名・アラーム名の接頭辞"
  type        = string
}

variable "alarm_email" {
  description = "アラーム通知先のメールアドレス。空文字なら購読を作らず、SNSトピックだけを用意する（後から手動/別経路で購読できる）"
  type        = string
  default     = ""
}

variable "lambda_function_names" {
  description = "エラー・スロットル・実行時間を監視するLambda関数名の一覧"
  type        = list(string)
}

variable "lambda_error_threshold" {
  description = "評価期間内のLambdaエラー数がこの値以上で発報する"
  type        = number
  default     = 1
}

variable "api_name" {
  description = "監視対象のAPI Gateway REST API名（ApiNameディメンション）"
  type        = string
}

variable "api_stage_name" {
  description = "監視対象のステージ名（Stageディメンション）"
  type        = string
}

variable "api_5xx_threshold" {
  description = "評価期間内のAPI Gateway 5XXError数がこの値以上で発報する"
  type        = number
  default     = 1
}

variable "api_4xx_threshold" {
  description = "評価期間内のAPI Gateway 4XXError数がこの値以上で発報する。スロットリング（429、ADR-027）の常態化に気づくための閾値"
  type        = number
  default     = 20
}

variable "backend_log_group_name" {
  description = "ERRORレベルのログを数えるメトリクスフィルタを張るbackendのロググループ名"
  type        = string
}

variable "period_seconds" {
  description = "アラームの評価期間（秒）"
  type        = number
  default     = 300
}
