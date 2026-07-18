output "bucket_name" {
  description = "静的アセットのアップロード先S3バケット名"
  value       = aws_s3_bucket.frontend.bucket
}

output "distribution_domain_name" {
  description = "CloudFrontのドメイン名（*.cloudfront.net）"
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_id" {
  description = "CloudFrontディストリビューションID（キャッシュ無効化に使う）"
  value       = aws_cloudfront_distribution.this.id
}
