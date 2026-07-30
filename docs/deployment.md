# デプロイ・運用手引き

`adapt-sheet` のデプロイ手順・環境変数設定・運用ルールをまとめる。インフラ構成の背景は [`architecture.md`](./architecture.md)、技術選定理由は [`decisions.md`](./decisions.md) を参照。

---

## 1. デプロイ全体フロー

1. PRを作成し、GitHub ActionsのCI（Vitest / pytest / ESLint / Ruff）が全て成功することを確認。
2. レビュー後、mainブランチへマージ（Branch Protection Ruleにより直接pushは不可）。
3. マージをトリガーにGitHub ActionsのCDが起動し、Terraformでインフラを適用、S3・Lambdaへ自動デプロイ。
4. デプロイ後、ステージングエンドポイントに対する疎通テストを実行。

詳細なCI/CD概要図は [`architecture.md`](./architecture.md#6-cicd概要図) を参照。

---

## 2. 環境変数

### バックエンド（Lambda / ローカル共通）

| 変数名 | 説明 | 備考 |
|---|---|---|
| `GEMINI_API_KEY` | Gemini API（Google AI Studio）利用のためのAPIキー | `USE_MOCK_AI=false`のときのみ必須（[CLAUDE.md](../CLAUDE.md)参照） |
| `USE_MOCK_AI` | AI呼び出しをモック層に固定するかどうかのスイッチ | 未設定時は`true`扱い（モック）。`false`の場合のみ`engine`に応じた実経路を呼び出す（ADR-006） |
| `GEMINI_MODEL` | 使用するGeminiモデル | 未設定時は`gemini-2.5-flash`。無料枠の日次クォータはモデル単位のため、上限到達時の切り替えに使う |
| `LOG_AI_PAYLOAD` | Geminiへの入力プロンプト全文・出力全文をログへ出すかどうかのスイッチ | 未設定時は`false`扱い（出力しない）。`true`/`1`/`yes`で有効。プロンプトには帳票の業務データが含まれるため、本番では有効化しない（ADR-011） |
| `SSM_PARAMETER_PREFIX` | Parameter Storeから秘密情報を取得する際のパス接頭辞（例: `/adapt-sheet/prod`） | Lambda本番でのみ設定。設定時、コールドスタート時に`{prefix}/GEMINI_API_KEY`等を復号取得し`os.environ`へ展開する。取得対象は`app/secrets_loader.py`の`_SECRET_ENV_NAMES`（APIキー3種＋`SUPABASE_JWT_SECRET`＋`DATABASE_URL`）。実値未投入のダミー（`PLACEHOLDER_SET_OUT_OF_BAND`）は展開しない。ローカル/pytestでは未設定のため何もしない |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase接続情報（Auth管理API用） | 現時点のバックエンドコードは未使用（JWT検証は`SUPABASE_JWT_SECRET`、DB接続は`DATABASE_URL`が担う）。管理APIを使う機能を追加する際に利用する想定 |
| `SUPABASE_JWT_SECRET` | Supabase Authが発行するJWTの検証鍵（HS256共有シークレット、SupabaseダッシュボードのJWT Settingsで確認） | `app/services/auth.py`が`/api/render`・`/api/history`のゲート判定に使用。未設定時は常に未ログイン扱い（fail-closed、ADR-020）。本番はParameter Store経由で渡す |
| `SUPABASE_JWT_JWKS_URL` | SupabaseがES256（JWT Signing Keys）を使う場合の公開鍵配布URL | 公開情報のためParameter Storeではなく、Terraform変数`supabase_jwt_jwks_url`経由でLambda環境変数として渡す（ADR-020/028）。HS256方式なら未設定でよい |
| `DATABASE_URL` | 生成履歴を保存するPostgreSQLの接続文字列（`postgresql+psycopg://...`） | `app/db.py`が使用。ローカルはdocker-composeの`db`サービス（Postgres）を指す既定値、本番はSupabaseプロジェクトのPostgres接続文字列をParameter Storeへ投入する。未設定時は`/api/render`の履歴保存を静かにスキップし、`/api/history`は500になる |

### フロントエンド

| 変数名 | 説明 |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase Auth SDK設定（`lib/supabaseClient.ts`）。未設定時はログインUI（`AuthPanel`）自体を非表示にする（ADR-020）。ビルド時に埋め込まれるため、値を変えたら再ビルド・再アップロードが必要 |

APIのベースURLは持たない。SPAとAPIは同一オリジン（CloudFront）から配信し、`src/lib/api.ts`は相対パス`/api/...`のまま本番でも動く。

### Supabase AuthのGoogleプロバイダ（ホスト型プロジェクト）

`supabase/config.toml`の`[auth.external.google]`はローカルCLI（`supabase start`）にのみ適用され、ホスト型（本番）Supabaseプロジェクトには反映されない。本番でGoogleログインを使うには、Supabaseダッシュボード側で個別に設定が必要。

1. Google Cloud ConsoleのOAuthクライアントに、本番用の認可済みリダイレクトURIを追加する: `https://<project-ref>.supabase.co/auth/v1/callback`（Supabaseダッシュボードの「Callback URL (for OAuth)」欄に表示される値をそのまま使う）
2. Supabaseダッシュボード → 対象プロジェクト → Authentication → Providers → Google を有効化し、Client ID / Secretを設定する。
3. Supabaseダッシュボード → Authentication → URL Configuration で、**Site URL**を本番フロントエンドURL（CloudFrontドメイン）に、**Redirect URLs**にも同URLを追加する。未設定のままだとログイン自体は成功するが、初期値の`http://localhost:3000`へ`?code=...`付きでリダイレクトされてしまう（ローカル開発用のURLはそのまま残してよい）。
4. `https://<project-ref>.supabase.co/auth/v1/settings` を叩き、`external.google: true`になっているか確認する。

1〜3はSupabase側（GoTrueサーバー）の設定であり、フロントエンドの再ビルド・再デプロイなしに即時反映される。未設定のままだとフロントの`signInWithOAuth({ provider: 'google' })`が`{"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`で失敗する。

### ClaudeCode / MCP

| 変数名 | 説明 | 備考 |
|---|---|---|
| `GITHUB_TOKEN` | GitHub MCP Server（`.mcp.json`）の認証に使用するPersonal Access Token | ローカルでは `.env`（gitignore対象）に設定し、`.envrc` + `direnv` での自動読み込みを想定（`direnv` 未導入の場合は手動で `export` する） |

機密情報（APIキー等）はリポジトリにコミットせず、GitHub ActionsのSecretsおよびAWS Systems Manager Parameter Store等で管理する。

---

## 3. バックエンドのコンテナ化（フェーズ4 ステップ24）

1. 本番用`backend/Dockerfile.lambda`に`AWS Lambda Web Adapter`のバイナリを`COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:...`で追加（開発用`backend/Dockerfile`とは別ファイル。イメージ名は`aws-lambda-adapter`で`web`は付かない）。
2. APIキーはイメージに焼き込まず、`SSM_PARAMETER_PREFIX`を設定してParameter Store（SecureString）から実行時に取得する。取得はLambdaのコールドスタート時（`app/secrets_loader.py`のグローバルスコープ呼び出し）に一度だけ行い、ハンドラ内では毎リクエストSSMを叩かない。
3. イメージは**ECR Private（`<account>.dkr.ecr.<region>.amazonaws.com`）**へpushする（Lambdaのコンテナイメージは同一リージョンのECR Privateからのみ取得できるため。無料枠500MBの逼迫はライフサイクルポリシーで抑える）。
4. コンテナ内で`pytest`を実行し、環境依存なくテストがパスすることを確認。

`docling-service`/`pdf2htmlex-service`も同様に本番用`Dockerfile.lambda`を持つ（Web Adapterバイナリの導入以外は開発用Dockerfileと同じ）。ただしこの2サービスはbackendからのみ呼ばれる内部専用サービスのため、API Gatewayではなく**AWS_IAM認証必須のLambda Function URL**として公開し、backend Lambdaの実行ロールのみに呼び出しを許可する。backendは`app/services/remote_extractor.py`でリクエストをAWS SigV4署名してから呼び出す（環境変数`DOCLING_SERVICE_AUTH`/`PDF2HTMLEX_SERVICE_AUTH=aws_sigv4`で有効化）。

---

## 4. インフラのコード化（フェーズ4 ステップ25）

Terraform定義は [`../infra/`](../infra/) に配置する（使い方は [`infra/README.md`](../infra/README.md)）。

- モジュール構成（`infra/modules/`）
  - `frontend`: CloudFront + S3（非公開バケット＋OAC、SPAフォールバック）
  - `lambda`: Lambda関数の共通モジュール。`backend`（入口エンドポイント、メモリ4GB既定、SSM読み取り＋SSM経由KMS復号の最小権限）、`render-worker`（backendと同じイメージを再利用する生成AI系engine専用の非同期ワーカー。API Gateway/Function URLを持たず、backendからの`lambda:invoke`のみ受け付ける。タイムアウト180秒。ADR-024）、`docling`/`pdf2htmlex`（内部専用、AWS_IAM認証Function URL、backend・render-worker双方から呼び出し許可）の4関数で共用する
  - `job_bucket`: 非同期レンダリングジョブのPDF・結果置き場となるS3バケット。1日で自動失効するライフサイクルルールと、ブラウザから署名付きURLへ直接PUTするためのCORS設定を持つ（ADR-024）
  - `api_gateway`: REST API（REGIONAL）→ backend Lambdaプロキシ。docling/pdf2htmlex/render-workerはAPI Gatewayを経由しない。ステージ単位のスロットリング（`aws_api_gateway_method_settings`）で過度なAPIコールを防ぐ（WAFは使わない）
  - `ecr`: backend/docling/pdf2htmlexそれぞれのコンテナイメージ用ECR Private（Lambdaは同一リージョンのPrivateからのみ取得可。ライフサイクルで容量抑制。render-workerはbackendと同じECRリポジトリ・イメージを使う）
  - `ssm`: APIキーのSecureString（枠のみ。実値はTerraform管理外で投入）
  - `monitoring`: CloudWatchアラーム（Lambdaのエラー/スロットル、API Gatewayの4XX/5XX、アプリログのERRORメトリクスフィルタ）と通知先のSNSトピック（ADR-011）
- state土台は `infra/bootstrap`（S3バケット＋ロック用DynamoDB）。chicken-egg回避のためローカルstateで最初にapplyする。
  - `github_oidc`: GitHub ActionsのOIDCプロバイダとCD用デプロイロール。長期の静的アクセスキーは発行せず、許可したリポジトリ・ブランチのワークフローだけがロールを引き受けられる
- デプロイ後、ステージング環境のエンドポイントに対してローカルからAPIテストを実行し疎通を確認する。

---

## 5. CI/CDの構築（フェーズ4 ステップ26）

- **CI（構築済み）**: `.github/workflows/ci.yml` が、PR作成時・mainマージ時にフロント（Vitest/ESLint/vite build）・バック（pytest/ruff）・docling/pdf2htmlex（pytest/ruff）をジョブ分割で自動実行する。ローカル開発と同じ`docker-compose.yml`のサービス定義を使い、ローカル/CIの実行結果を乖離させない。
- 「CIが100%成功しなければマージ不可」はBranch Protection Ruleに設定済み（[CLAUDE.md](../CLAUDE.md) のGit/CI運用ルール参照）。必須チェックは`backend` / `docling` / `pdf2htmlex` / `frontend` の4ジョブ。
- **CD**: `.github/workflows/cd.yml` が、mainへのpush（＝マージ）と手動実行で本番へデプロイする。AWSの長期アクセスキーは持たず、OIDC（`infra/modules/github_oidc`）で発行される短期認証情報でデプロイロールを引き受ける。

### CDの流れ

1. OIDCでデプロイロールを引き受け、ECRへログイン。
2. `backend` / `docling` / `pdf2htmlex` の3イメージを`Dockerfile.lambda`からビルドし、コミットSHAのタグでECR Privateへpush。
3. ビルドした`backend`イメージで`alembic upgrade head`を実行し、本番DBのスキーマを最新化する（デプロイ前に適用し、新しいコードが存在しないテーブルへアクセスする事故を防ぐ）。
4. `terraform apply`（`image_tag`等にコミットSHAを渡す）でインフラを適用し、Lambdaを新しいイメージへ更新。
5. フロントをビルドしてS3へ同期し、CloudFrontのキャッシュを無効化。`index.html`だけキャッシュさせず、ハッシュ付きアセットは長期キャッシュする。
6. `POST /api/warmup` でbackend→docling/pdf2htmlex/DBの疎通をスモークテストする。

### CDに必要なGitHubリポジトリ設定

| 種別 | 名前 | 内容 |
|---|---|---|
| Variables | `AWS_DEPLOY_ROLE_ARN` | `terraform output github_actions_role_arn` の値 |
| Variables | `TF_STATE_BUCKET` / `TF_STATE_LOCK_TABLE` | `infra/bootstrap` の出力値 |
| Variables | `VITE_SUPABASE_URL` | フロントのビルド時に埋め込むSupabase URL |
| Variables | `SUPABASE_JWT_JWKS_URL` | ES256（JWT Signing Keys）方式の場合のみ設定。HS256なら未設定でよい |
| Variables | `ALARM_EMAIL` | CloudWatchアラームの通知先。未設定ならSNSトピックのみ作成 |
| Variables | `CREATE_GITHUB_OIDC_PROVIDER` | OIDCプロバイダが既にアカウントにある場合のみ`false` |
| Secrets | `VITE_SUPABASE_ANON_KEY` | フロントのビルド時に埋め込むanon key |
| Secrets | `MIGRATION_DATABASE_URL` | 本番Supabaseの`postgres`ロール（所有者権限）接続文字列。マイグレーション専用で、実行時用の`DATABASE_URL`（Parameter Store、`authenticator`ロール）とは別物 |

初回だけは、CDが動く前提（state土台・ECR・Lambda・デプロイロール）をローカルから手動で作る必要がある（[infra/README.md](../infra/README.md) の手順1〜6）。それまでの間、CDは`AWS_DEPLOY_ROLE_ARN`が未設定であることを検知してジョブごとスキップする。

---

## 6. 運用時の注意点

- **APIキーのローテーション**: Parameter Store（SecureString）の値を更新後、Lambdaの実行環境を入れ替える（新デプロイ or 再デプロイ）ことで、次のコールドスタート時に新しいキーが読み込まれる（キャッシュはコールドスタート単位）。
- **レート制限**: WAFは使わず、API Gatewayのステージ単位スロットリング（全メソッド合算、認証有無を区別しない）で過度なAPIコールを防ぐ（[architecture.md](./architecture.md#5-セキュリティ概要図) 参照）。
- **ロールバック**: Terraform管理下のため、問題発生時は直前のTerraform state / GitHub Actionsのデプロイ履歴から切り戻す。
- **ログ・アラームの確認**: 障害時にどのログをどう引くかは [observability.md](./observability.md) に手順をまとめている。アラームはSNSトピック（`terraform output alarm_topic_arn`）へ集約され、`alarm_email` を設定した場合は**購読確認メールのリンクを踏むまで通知が届かない**点に注意（ADR-011）。
- **ログの保持期間**: `log_retention_in_days`（既定30日）がLambda・API Gateway・CloudFrontのログへ一括で適用される。伸ばすほどCloudWatch Logs / S3の保管料が増える。

---

## 7. terraform apply実績（本番環境）

`ap-northeast-1`へ`infra/README.md`の手順（bootstrap → ECR先行apply → 本体apply）で実AWSリソースを作成済み。主な出力値（`terraform output`。AWSアカウントIDはリポジトリが公開のため`<account_id>`に置き換える）:

| 出力名 | 値 |
|---|---|
| `app_url` | `https://d3lal8vccjsy5y.cloudfront.net` |
| `cloudfront_distribution_id` | `E30NSRCIJ7685A` |
| `api_invoke_url` | `https://b8h9qwvzi6.execute-api.ap-northeast-1.amazonaws.com/prod` |
| `lambda_function_name` | `adapt-sheet-prod-backend` |
| `render_worker_function_name` | `adapt-sheet-prod-render-worker` |
| `docling_function_url` | `https://u3ne5g7snhwlixmdv6xczioppm0fkmmq.lambda-url.ap-northeast-1.on.aws/` |
| `pdf2htmlex_function_url` | `https://mqr7chmqonrcydabqh6xm2nksi0loryt.lambda-url.ap-northeast-1.on.aws/` |
| `ecr_repository_url` | `<account_id>.dkr.ecr.ap-northeast-1.amazonaws.com/adapt-sheet-prod-backend` |
| `ecr_docling_repository_url` | `<account_id>.dkr.ecr.ap-northeast-1.amazonaws.com/adapt-sheet-prod-docling` |
| `ecr_pdf2htmlex_repository_url` | `<account_id>.dkr.ecr.ap-northeast-1.amazonaws.com/adapt-sheet-prod-pdf2htmlex` |
| `frontend_bucket_name` | `adapt-sheet-prod-frontend-<account_id>` |
| `render_jobs_bucket_name` | `adapt-sheet-prod-render-jobs-<account_id>` |
| `ssm_parameter_prefix` | `/adapt-sheet/prod` |
| `github_actions_role_arn` | `arn:aws:iam::<account_id>:role/adapt-sheet-prod-github-actions` |
| `alarm_topic_arn` | `arn:aws:sns:ap-northeast-1:<account_id>:adapt-sheet-prod-alarms` |
| `api_access_log_group_name` | `/aws/apigateway/adapt-sheet-prod-api/access` |

`docling_function_url` / `pdf2htmlex_function_url`はAWS_IAM認証必須のFunction URLのため、URL単体の漏洩では呼び出せない。
