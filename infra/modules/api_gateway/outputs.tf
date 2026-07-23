output "invoke_url" {
  description = "ステージの呼び出しURL"
  value       = aws_api_gateway_stage.this.invoke_url
}

output "origin_domain_name" {
  description = "CloudFrontのオリジンに指定するAPI Gatewayのドメイン名（ステージパスを含まない）"
  value       = "${aws_api_gateway_rest_api.this.id}.execute-api.${data.aws_region.current.name}.amazonaws.com"
}

output "origin_path" {
  description = "CloudFrontのorigin_pathに指定するステージパス（例: /prod）"
  value       = "/${aws_api_gateway_stage.this.stage_name}"
}

output "stage_name" {
  description = "ステージ名（CloudWatchアラームのディメンションに使う）"
  value       = aws_api_gateway_stage.this.stage_name
}

output "access_log_group_name" {
  description = "アクセスログのCloudWatch Logsロググループ名"
  value       = aws_cloudwatch_log_group.access.name
}

output "rest_api_id" {
  description = "REST APIのID"
  value       = aws_api_gateway_rest_api.this.id
}
