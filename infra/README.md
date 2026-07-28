# infra — Terraform によるAWSインフラ定義（フェーズ4 ステップ25）

`adapt-sheet` のAWSインフラ（ECR Private / Lambda / API Gateway / CloudFront+S3 / SSM Parameter Store）を Terraform で定義する。手順の詳細は [`../docs/deployment.md`](../docs/deployment.md) を参照。

> 本番デプロイの配線（SPAとAPIの同一オリジン化・バイナリ透過・秘密情報の受け渡し・doclingのモデル同梱）は整理済み。`terraform apply`の実施はユーザー承認後に行う。

## 構成

```
infra/
├── bootstrap/        # state用S3バケット＋ロック用DynamoDB（chicken-egg回避で最初にローカルstateでapply）
├── modules/
│   ├── ecr/          # backend/docling/pdf2htmlexそれぞれのコンテナイメージ用ECR Private（Lambdaは同一リージョンのPrivateからのみ取得可）
│   ├── ssm/          # APIキーのSecureString（枠のみ。実値はTerraform管理外で投入）
│   ├── lambda/       # Lambda関数の共通モジュール。backend（SSM読み取り＋SSM経由KMS復号の最小権限）と、docling/pdf2htmlex（AWS_IAM認証Function URL、backendのみ呼び出し許可）で共用
│   ├── api_gateway/  # REST API（REGIONAL）→ backend Lambdaプロキシ。ステージ全体のスロットリングで過度なAPIコールを防ぐ（WAFは使わない）。アクセスログ（JSON）をCloudWatch Logsへ出す
│   ├── monitoring/   # CloudWatchアラーム（Lambda・API Gateway・アプリログのERROR）と通知先SNSトピック
│   ├── github_oidc/  # GitHub ActionsのOIDCプロバイダ＋CD用デプロイロール（長期アクセスキーを発行しない）
│   └── frontend/     # 非公開S3 ＋ CloudFront（OAC）。SPAフォールバック付き。標準アクセスログを専用S3バケットへ出す
├── versions.tf / providers.tf / backend.tf
├── variables.tf / main.tf / outputs.tf
└── terraform.tfvars.example
```

## 使い方（apply は承認後に実施）

> Terraformのバージョンはリポジトリ直下の [`../mise.toml`](../mise.toml) で固定する。以下のコマンドを実行する前に、リポジトリのルートで `mise install` を済ませ、`terraform version` が `mise.toml` の値と一致することを確認する。providerのバージョンは `.terraform.lock.hcl`（コミット対象）で固定されており、更新する場合は `terraform providers lock -platform=darwin_arm64 -platform=linux_amd64` で開発機とCIの両プラットフォーム分のチェックサムを記録する。

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

   `terraform.tfvars.example` を `terraform.tfvars` へ複製し、`state_bucket_name` を手順1の値へ差し替えてから実行する（未設定だと変数のバリデーションで停止する）。

4. **初回applyはECRを先に作る**

   Lambdaはイメージが存在しないと作成に失敗するため、初回だけECRリポジトリを先に作り、イメージをpushしてから全体をapplyする（2回目以降は`terraform apply`のみでよい）。

   ```bash
   terraform apply -target=module.ecr -target=module.ecr_docling -target=module.ecr_pdf2htmlex
   # 手順6でイメージをpushしてから
   terraform apply
   ```

5. **秘密情報の投入（Terraform管理外）**

   `ssm` モジュールはSecureStringの**枠だけ**をダミー値（`PLACEHOLDER_SET_OUT_OF_BAND`）で作る。実値は次のように投入する（コミットしない）。ダミーのままの項目は`app/secrets_loader.py`が「未投入」とみなして展開しないため、`DATABASE_URL`を投入するまで履歴保存は静かにスキップされる。

   ```bash
   for name in GEMINI_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY SUPABASE_JWT_SECRET DATABASE_URL; do
     aws ssm put-parameter --name "/adapt-sheet/prod/${name}" \
       --type SecureString --value "<実値>" --overwrite
   done
   ```

6. **コンテナイメージのビルドとpush**

   Lambdaは`x86_64`固定（pdf2htmlEXのベースイメージがx86_64限定のため）。**開発機がApple Siliconの場合、`--platform linux/amd64`を付けないとarm64イメージができ、`terraform apply`または関数更新時に失敗する**。

   ```bash
   ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
   REGISTRY="${ACCOUNT_ID}.dkr.ecr.ap-northeast-1.amazonaws.com"
   aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin "${REGISTRY}"

   # backend / docling / pdf2htmlex の3つを同じ手順でビルド・pushする。
   docker build --platform linux/amd64 -f backend/Dockerfile.lambda -t "${REGISTRY}/adapt-sheet-prod-backend:latest" backend
   docker push "${REGISTRY}/adapt-sheet-prod-backend:latest"
   ```

   同一タグへpushしただけではLambdaは新しいイメージを引き直さないため、`aws lambda update-function-code --function-name adapt-sheet-prod-backend --image-uri ...` を実行する（またはタグを世代ごとに変えて`image_tag`変数を更新し`terraform apply`する）。**`render-worker`はbackendと同じイメージ（`image_tag`変数を共有）を使うため、backendコード（`backend/`配下）を変更した場合は`adapt-sheet-prod-render-worker`にも同じ`update-function-code`を実行する**（ADR-024）。CD（`.github/workflows/cd.yml`）は`terraform apply`経由で両方とも自動更新するため、この手動操作はローカルからの手動デプロイ時のみ必要。

7. **フロントエンドの配置**

   ```bash
   docker compose exec frontend npm run build     # VITE_SUPABASE_* はビルド時に埋め込まれる
   aws s3 sync frontend/dist "s3://$(terraform -chdir=infra output -raw frontend_bucket_name)/" --delete
   aws cloudfront create-invalidation \
     --distribution-id "$(terraform -chdir=infra output -raw cloudfront_distribution_id)" --paths '/*'
   ```

   アプリの入口は`terraform output app_url`（CloudFrontのドメイン）。SPAと`/api/*`の両方を同じオリジンから配信するため、フロントに個別のAPIベースURLは設定しない。

## 前提・注意

- **ECR Private**: Lambdaのコンテナイメージは同一アカウント・同一リージョンのECR Privateからのみ取得できる（ECR Public不可）。無料枠500MBの逼迫はライフサイクル（最新数世代のみ保持）で抑える。
- **AWS認証**: GitHub ActionsからのデプロイはOIDCで行う（長期アクセスキーは発行しない）。`github_oidc`モジュールがOIDCプロバイダとデプロイロールを作り、`github_allowed_refs`（既定は`main`のみ）以外のブランチからは引き受けられない。`terraform output github_actions_role_arn` の値をリポジトリ変数`AWS_DEPLOY_ROLE_ARN`へ設定する。
- **デプロイロールの権限**: `terraform apply`を代行するため対象サービスは広く許可せざるを得ないが、IAMだけは権限昇格を防ぐため`adapt-sheet-*`のロールに限定している。
- **秘密情報**: APIキーはstateにもイメージにも残さない。`aws_ssm_parameter` は `ignore_changes = [value]` で実値を追跡しない。
- **レート制限**: WAFは使わず、API Gatewayのステージ単位スロットリング（`aws_api_gateway_method_settings`）で代替する。IPアドレスごとの個別制限ではなく全メソッド合算のカウントのため、1クライアントの連打が他の利用者にも影響しうる点に留意する。
