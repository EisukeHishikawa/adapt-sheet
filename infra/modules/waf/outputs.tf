output "web_acl_arn" {
  description = "作成したWeb ACLのARN"
  value       = aws_wafv2_web_acl.this.arn
}
