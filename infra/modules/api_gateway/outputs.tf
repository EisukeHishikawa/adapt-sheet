output "invoke_url" {
  description = "ステージの呼び出しURL"
  value       = aws_api_gateway_stage.this.invoke_url
}

output "rest_api_id" {
  description = "REST APIのID"
  value       = aws_api_gateway_rest_api.this.id
}
