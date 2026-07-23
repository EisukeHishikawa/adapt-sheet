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

output "rest_api_id" {
  description = "REST APIのID"
  value       = aws_api_gateway_rest_api.this.id
}
