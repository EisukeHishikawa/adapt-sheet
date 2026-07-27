output "bucket_name" {
  description = "S3バケット名"
  value       = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  description = "S3バケットのARN"
  value       = aws_s3_bucket.this.arn
}
