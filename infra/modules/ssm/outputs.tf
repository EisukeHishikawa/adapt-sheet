output "parameter_arns" {
  description = "作成したSecureStringパラメータのARN一覧（Lambda実行ロールの読み取り対象）"
  value       = [for p in aws_ssm_parameter.secret : p.arn]
}

output "prefix" {
  description = "パラメータ名の接頭辞"
  value       = var.prefix
}
