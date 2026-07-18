output "invoke_url" {
  description = "ステージの呼び出しURL"
  value       = aws_api_gateway_stage.this.invoke_url
}

output "stage_arn" {
  description = "WAF関連付けに使うステージARN"
  value       = aws_api_gateway_stage.this.arn
}

output "rest_api_id" {
  description = "REST APIのID"
  value       = aws_api_gateway_rest_api.this.id
}
