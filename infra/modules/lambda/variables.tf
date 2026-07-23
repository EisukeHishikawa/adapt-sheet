variable "name" {
  description = "Lambda関数名（IAMロール名の接頭辞にも使う）"
  type        = string
}

variable "image_uri" {
  description = "ECR PrivateのコンテナイメージURI（<repo_url>:<tag>）"
  type        = string
}

variable "memory_size" {
  description = "メモリ割り当て（MB）"
  type        = number
  default     = 4096
}

variable "timeout" {
  description = "タイムアウト（秒）"
  type        = number
  default     = 60
}

variable "ssm_prefix" {
  description = "APIキーのParameter Storeパス接頭辞（SSM_PARAMETER_PREFIX）。APIキーを扱わないLambda（docling/pdf2htmlex）は空文字のまま渡し、環境変数自体を設定しない（ADR-026）"
  type        = string
  default     = ""
}

variable "ssm_parameter_arns" {
  description = "読み取りを許可するSecureStringパラメータのARN一覧。空リストならSSM読み取り権限を一切付与しない（ADR-026）"
  type        = list(string)
  default     = []
}

variable "use_mock_ai" {
  description = "USE_MOCK_AI環境変数の値。空文字なら環境変数自体を設定しない"
  type        = string
  default     = ""
}

variable "extra_env" {
  description = "追加のLambda環境変数（GEMINI_MODEL等、任意）"
  type        = map(string)
  default     = {}
}

variable "create_function_url" {
  description = "AWS_IAM認証必須のLambda Function URLを作成するか。内部専用サービス（docling/pdf2htmlex）をAPI Gatewayを介さず直接HTTPで公開する場合にtrue（ADR-026）"
  type        = bool
  default     = false
}

variable "function_url_invoker_role_arns" {
  description = "create_function_url=true のとき、このFunction URLの呼び出しを許可するIAMロールARNの一覧（resource-based policy）"
  type        = list(string)
  default     = []
}

variable "invoke_function_url_arns" {
  description = "このLambdaの実行ロールにlambda:InvokeFunctionUrlを許可する呼び出し先Lambda関数ARNの一覧（identity-based）。backend LambdaがDocling/pdf2htmlexのFunction URLを呼ぶために使う（ADR-026）"
  type        = list(string)
  default     = []
}
