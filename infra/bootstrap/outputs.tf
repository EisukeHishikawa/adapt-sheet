output "state_bucket_name" {
  description = "本体のinit時に -backend-config=bucket= へ渡す値"
  value       = aws_s3_bucket.tfstate.bucket
}

output "lock_table_name" {
  description = "本体のinit時に -backend-config=dynamodb_table= へ渡す値"
  value       = aws_dynamodb_table.tflock.name
}
