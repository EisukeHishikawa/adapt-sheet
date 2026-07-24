output "function_name" {
  description = "Lambda関数名"
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "Lambda関数のARN"
  value       = aws_lambda_function.this.arn
}

output "invoke_arn" {
  description = "API GatewayのAWS_PROXY統合に渡す呼び出しARN"
  value       = aws_lambda_function.this.invoke_arn
}

output "log_group_name" {
  description = "この関数のCloudWatch Logsロググループ名（メトリクスフィルタの対象に使う）"
  value       = aws_cloudwatch_log_group.this.name
}

output "role_arn" {
  description = "Lambda実行ロールのARN"
  value       = aws_iam_role.this.arn
}

output "function_url" {
  description = "AWS_IAM認証必須のFunction URL（create_function_url=trueのときのみ値が入る）"
  value       = var.create_function_url ? aws_lambda_function_url.this[0].function_url : null
}
