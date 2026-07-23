output "ecr_repository_url" {
  description = "backendイメージをpushするECR PrivateリポジトリURL"
  value       = module.ecr.repository_url
}

output "lambda_function_name" {
  description = "入口エンドポイントのLambda関数名"
  value       = module.lambda.function_name
}

output "ecr_docling_repository_url" {
  description = "docling-serviceイメージをpushするECR PrivateリポジトリURL"
  value       = module.ecr_docling.repository_url
}

output "ecr_pdf2htmlex_repository_url" {
  description = "pdf2htmlex-serviceイメージをpushするECR PrivateリポジトリURL"
  value       = module.ecr_pdf2htmlex.repository_url
}

output "docling_function_url" {
  description = "docling-service LambdaのFunction URL（AWS_IAM認証必須、backendのみ呼び出し可。ADR-026）"
  value       = module.lambda_docling.function_url
}

output "pdf2htmlex_function_url" {
  description = "pdf2htmlex-service LambdaのFunction URL（AWS_IAM認証必須、backendのみ呼び出し可。ADR-026）"
  value       = module.lambda_pdf2htmlex.function_url
}

output "api_invoke_url" {
  description = "API Gatewayのステージ呼び出しURL（CloudFrontを介さない直接疎通テスト用。ブラウザからはCloudFront経由の/api/*を使う）"
  value       = module.api.invoke_url
}

output "app_url" {
  description = "アプリの入口URL。SPAと/api/*の両方をこのオリジンから配信する"
  value       = "https://${module.frontend.distribution_domain_name}"
}

output "cloudfront_domain_name" {
  description = "フロントエンド配信のCloudFrontドメイン"
  value       = module.frontend.distribution_domain_name
}

output "cloudfront_distribution_id" {
  description = "デプロイ後のキャッシュ無効化（aws cloudfront create-invalidation）に使うID"
  value       = module.frontend.distribution_id
}

output "frontend_bucket_name" {
  description = "フロントエンドの静的アセットをアップロードするS3バケット名"
  value       = module.frontend.bucket_name
}

output "ssm_parameter_prefix" {
  description = "APIキーのParameter Storeパス接頭辞（LambdaのSSM_PARAMETER_PREFIX）"
  value       = local.ssm_prefix
}

output "alarm_topic_arn" {
  description = "CloudWatchアラームの通知先SNSトピックARN（購読を後から追加する際に使う。ADR-030）"
  value       = module.monitoring.alarm_topic_arn
}

output "api_access_log_group_name" {
  description = "API GatewayアクセスログのCloudWatch Logsロググループ名（ADR-030）"
  value       = module.api.access_log_group_name
}
