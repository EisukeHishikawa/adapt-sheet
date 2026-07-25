data "aws_caller_identity" "current" {}

locals {
  oidc_url  = "https://token.actions.githubusercontent.com"
  oidc_host = "token.actions.githubusercontent.com"

  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn

  account_id = data.aws_caller_identity.current.account_id

  # このロールが触ってよいIAMリソース。プロジェクト接頭辞に限定し、無関係なロールへの
  # 権限昇格経路を塞ぐ。
  managed_role_arns = [
    "arn:aws:iam::${local.account_id}:role/${var.name}*",
  ]
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url            = local.oidc_url
  client_id_list = ["sts.amazonaws.com"]
  # STSはGitHubのTLS証明書チェーンを自前で検証するためthumbprintは実質参照されないが、
  # APIが必須項目として要求するためGitHubの公開値を設定する。
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1

  url = local.oidc_url
}

# 長期アクセスキーを発行せず、GitHub Actionsの短期トークンからのみ引き受けられるロール。
# subを固定することで、同じリポジトリでも許可したブランチ以外からは引き受けられない。
data "aws_iam_policy_document" "assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = [for ref in var.allowed_refs : "repo:${var.github_repository}:ref:${ref}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name}-github-actions"
  description          = "GitHub Actions（CD）がOIDCで引き受けるデプロイロール"
  assume_role_policy   = data.aws_iam_policy_document.assume.json
  max_session_duration = 3600
}

# terraform init/apply がstateの読み書きとロックのために必要とする権限。
data "aws_iam_policy_document" "state" {
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:GetBucketVersioning"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}"]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = ["arn:aws:dynamodb:*:${local.account_id}:table/${var.lock_table_name}"]
  }
}

resource "aws_iam_role_policy" "state" {
  name   = "terraform-state"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.state.json
}

# infra/ が管理する各サービスのリソースを作成・更新・削除するための権限。
# 多くのAPIがリソース単位の絞り込みに対応しないため、サービス単位で許可し、
# 権限昇格に直結するIAMのみ別ステートメントで接頭辞に限定する。
data "aws_iam_policy_document" "infra" {
  statement {
    effect = "Allow"
    actions = [
      "ecr:*",
      "lambda:*",
      "apigateway:*",
      "cloudfront:*",
      "s3:*",
      "ssm:*",
      "kms:Describe*",
      "kms:Decrypt",
      "kms:Encrypt",
      "logs:*",
      "sns:*",
      "cloudwatch:*",
      "xray:*",
      "sts:GetCallerIdentity",
      "tag:GetResources",
    ]
    resources = ["*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:PassRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRoleTags",
      "iam:UpdateAssumeRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = local.managed_role_arns
  }

  # OIDCプロバイダ自体もTerraform管理下にあるため、planでの参照と更新を許可する。
  statement {
    effect = "Allow"
    actions = [
      "iam:GetOpenIDConnectProvider",
      "iam:TagOpenIDConnectProvider",
      "iam:UpdateOpenIDConnectProviderThumbprint",
    ]
    resources = ["arn:aws:iam::${local.account_id}:oidc-provider/${local.oidc_host}"]
  }

  # API Gatewayのアカウント単位のCloudWatchロール設定に必要（サービスリンクロールの作成）。
  statement {
    effect    = "Allow"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "infra" {
  name   = "terraform-infra"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.infra.json
}
