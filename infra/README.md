# infra — Terraform によるAWSインフラ定義（フェーズ4 ステップ25）

`adapt-sheet` のAWSインフラ（ECR Private / Lambda / API Gateway / WAF / CloudFront+S3 / SSM Parameter Store）を Terraform で定義する。背景は [`../docs/decisions.md`](../docs/decisions.md) の ADR-005（IaC一本化）・ADR-017（backendのLambda本番イメージ）・ADR-026（docling/pdf2htmlexのLambda化）、手順の詳細は [`../docs/deployment.md`](../docs/deployment.md) を参照。

> 本ステップは**コード定義まで**。`terraform apply`（実AWSリソースの作成）はまだ行わない。

## 構成

```
infra/
├── bootstrap/        # state用S3バケット＋ロック用DynamoDB（chicken-egg回避で最初にローカルstateでapply）
├── modules/
│   ├── ecr/          # backend/docling/pdf2htmlexそれぞれのコンテナイメージ用ECR Private（Lambdaは同一リージョンのPrivateからのみ取得可）
│   ├── ssm/          # APIキーのSecureString（枠のみ。実値はTerraform管理外で投入）
│   ├── lambda/       # Lambda関数の共通モジュール。backend（SSM読み取り＋SSM経由KMS復号の最小権限）と、docling/pdf2htmlex（AWS_IAM認証Function URL、backendのみ呼び出し許可。ADR-026）で共用
│   ├── api_gateway/  # REST API（REGIONAL）→ backend Lambdaプロキシ（WAF関連付けのためHTTP APIではなくREST）
│   ├── waf/          # AWSマネージドルール＋IPレート制限。API Gatewayステージへ関連付け
│   └── frontend/     # 非公開S3 ＋ CloudFront（OAC）。SPAフォールバック付き
├── versions.tf / providers.tf / backend.tf
├── variables.tf / main.tf / outputs.tf
└── terraform.tfvars.example
```

## 使い方（apply はステップ25の対象外・承認後に実施）

> Terraformのバージョンはリポジトリ直下の [`../mise.toml`](../mise.toml) で固定する（ADR-023）。以下のコマンドを実行する前に、リポジトリのルートで `mise install` を済ませ、`terraform version` が `mise.toml` の値と一致することを確認する。providerのバージョンは `.terraform.lock.hcl`（コミット対象）で固定されており、更新する場合は `terraform providers lock -platform=darwin_arm64 -platform=linux_amd64` で開発機とCIの両プラットフォーム分のチェックサムを記録する。

1. **state土台の作成（初回のみ）**

   ```bash
   cd infra/bootstrap
   terraform init
   terraform apply -var="state_bucket_name=adapt-sheet-tfstate-<account_id>"
   ```

2. **本体の初期化（S3バックエンドを bootstrap の値へ向ける）**

   ```bash
   cd infra
   terraform init \
     -backend-config="bucket=adapt-sheet-tfstate-<account_id>" \
     -backend-config="key=prod/terraform.tfstate" \
     -backend-config="region=ap-northeast-1" \
     -backend-config="dynamodb_table=adapt-sheet-tflock" \
     -backend-config="encrypt=true"
   ```

3. **検証**

   ```bash
   terraform fmt -recursive
   terraform validate
   terraform plan   # 承認後に apply
   ```

4. **APIキーの投入（Terraform管理外）**

   `ssm` モジュールはSecureStringの**枠だけ**をダミー値で作る。実値は次のように投入する（コミットしない）。

   ```bash
   aws ssm put-parameter --name "/adapt-sheet/prod/GEMINI_API_KEY" \
     --type SecureString --value "<実キー>" --overwrite
   ```

## 前提・注意

- **ECR Private**: Lambdaのコンテナイメージは同一アカウント・同一リージョンのECR Privateからのみ取得できる（ECR Public不可）。ステップ24でECR Publicとしていた方針を本ステップでECR Privateへ訂正した（ADR-017）。無料枠500MBの逼迫はライフサイクル（最新数世代のみ保持）で抑える。
- **AWS認証**: GitHub ActionsからのデプロイはOIDCで行う（長期アクセスキーは発行しない）。OIDCプロバイダ/デプロイロールはステップ26のCI/CD構築時に定義する。
- **秘密情報**: APIキーはstateにもイメージにも残さない。`aws_ssm_parameter` は `ignore_changes = [value]` で実値を追跡しない。
