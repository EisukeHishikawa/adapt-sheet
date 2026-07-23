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
  description = "API Gatewayのステージ呼び出しURL（疎通テスト・フロントのVITE_API_BASE_URL用）"
  value       = module.api.invoke_url
}

output "cloudfront_domain_name" {
  description = "フロントエンド配信のCloudFrontドメイン"
  value       = module.frontend.distribution_domain_name
}

output "frontend_bucket_name" {
  description = "フロントエンドの静的アセットをアップロードするS3バケット名"
  value       = module.frontend.bucket_name
}

output "ssm_parameter_prefix" {
  description = "APIキーのParameter Storeパス接頭辞（LambdaのSSM_PARAMETER_PREFIX）"
  value       = local.ssm_prefix
}
