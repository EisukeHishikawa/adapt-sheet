output "role_arn" {
  description = "GitHub Actionsがaws-actions/configure-aws-credentialsで引き受けるロールのARN"
  value       = aws_iam_role.deploy.arn
}

output "oidc_provider_arn" {
  description = "GitHub ActionsのOIDCプロバイダARN"
  value       = local.oidc_provider_arn
}
