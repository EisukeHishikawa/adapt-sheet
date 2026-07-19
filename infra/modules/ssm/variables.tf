variable "prefix" {
  description = "パラメータ名の接頭辞（例: /adapt-sheet/prod）"
  type        = string
}

variable "secret_names" {
  description = "作成するSecureStringパラメータの名前（環境変数名に対応）"
  type        = list(string)
}
