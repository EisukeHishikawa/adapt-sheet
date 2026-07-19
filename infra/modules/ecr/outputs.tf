output "repository_url" {
  description = "イメージのpush先URL（<account>.dkr.ecr.<region>.amazonaws.com/<name>）"
  value       = aws_ecr_repository.this.repository_url
}

output "repository_arn" {
  description = "ECRリポジトリのARN"
  value       = aws_ecr_repository.this.arn
}
