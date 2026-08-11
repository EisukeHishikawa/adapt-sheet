# デプロイ・運用手引き

AdaptSheet AIのデプロイ手順・環境変数設定・運用ルールをまとめる。インフラ構成の背景は [`architecture.md`](./architecture.md)、技術選定理由は [`decisions.md`](./decisions.md) を参照。

---

## 1. デプロイ全体フロー

1. PRを作成し、GitHub ActionsのCI（Vitest / pytest / ESLint / Ruff）が全て成功することを確認。
2. レビュー後、mainブランチへマージ（Branch Protection Ruleにより直接pushは不可）。
3. マージをトリガーにGitHub ActionsのCDが起動し、Terraformでインフラを適用、S3・Lambdaへ自動デプロイ。
4. デプロイ後、ステージングエンドポイントに対する疎通テストを実行。

詳細なCI/CD概要図は [`architecture.md`](./architecture.md#6-cicd概要図) を参照。

---

## 2. 環境変数

### 2-1. 格納場所の原則

秘密情報はリポジトリにコミットしない。開発・本番それぞれ、値の置き場所は次の4つに限定する。

| 環境 | 格納場所 | 対象 |
|---|---|---|
| 開発 | プロジェクトルートの`.env`（Git管理外） | APIキー・DB接続文字列・Supabaseの鍵。`docker-compose.yml`が`${...}`展開で各コンテナへ渡す。`.envrc`（direnv）の`dotenv`によりホストのシェルにも展開され、`scripts/create_user.sh`等から参照できる |
| 開発 | `docker-compose.yml`に直書き | 秘密でない固定のローカル定数（サービス名でのURL解決、MinIOの資格情報、モック有効化等） |
| 本番 | SSM Parameter Store（SecureString、`/adapt-sheet/prod/*`） | 秘密情報のみ。対象は`infra/variables.tf`の`secret_parameter_names`と`app/secrets_loader.py`の`_SECRET_ENV_NAMES`を一致させる。コールドスタート時に復号して`os.environ`へ展開する（Lambdaの環境変数はコンソールで平文表示されるため秘密情報は置かない） |
| 本番 | Terraformが設定するLambda環境変数（`infra/main.tf`の`extra_env`） | 秘密でない接続先・スイッチ（Function URL、S3バケット名、`USE_MOCK_AI`等） |

フロントエンドの`VITE_*`はビルド時にJSへ埋め込まれるため、実行時の格納場所を持たない。値はGitHub ActionsのVariables / Secretsに置き、CDのビルド手順で注入する（[5. CI/CD](#5-cicd) 参照）。

### 2-2. バックエンド（backend / render-worker）

| 変数名 | 説明 | 開発（docker compose） | 本番（Lambda） |
|---|---|---|---|
| `USE_MOCK_AI` | AI呼び出しをモック層に固定するスイッチ。未設定時は`true`扱いで、`false`のときだけ`engine`に応じた実経路を呼ぶ | `true`（compose直書き） | `false`（Terraform変数`use_mock_ai`） |
| `GEMINI_API_KEY` | Gemini API（Google AI Studio）のAPIキー | `.env` | Parameter Store |
| `ANTHROPIC_API_KEY` | Claude（`engine=claude`）のAPIキー | `.env` | Parameter Store |
| `OPENAI_API_KEY` | OpenAI（`engine=openai`）のAPIキー | `.env` | Parameter Store |
| `GEMINI_MODEL` | 無料枠（`gemini_free`/`hybrid`）で使うGeminiモデル。既定は`gemini-flash-latest`。無料枠の日次クォータはモデル単位のため、上限到達時の切り替えに使う | 任意（`.env`） | 未設定（既定値） |
| `GEMINI_STANDARD_MODEL` | 標準プラン（`engine=gemini`）のモデル。既定は`gemini-2.5-pro` | 任意（`.env`） | 未設定（既定値） |
| `CLAUDE_MODEL` | `engine=claude`のモデル。既定は`claude-opus-4-8` | 任意（`.env`） | 未設定（既定値） |
| `OPENAI_MODEL` | `engine=openai`のモデル。既定は`gpt-5.1` | 任意（`.env`） | 未設定（既定値） |
| `LOG_AI_PAYLOAD` | 生成AIへの入力プロンプト全文・出力全文をログへ出すスイッチ（`true`/`1`/`yes`で有効、未設定時は無効）。プロンプトに帳票の業務データが含まれるため本番では有効化しない | `true`（compose直書き） | 未設定 |
| `SUPABASE_JWT_SECRET` | Supabase Authが発行するJWTの検証鍵（HS256共有シークレット）。`app/services/auth.py`がゲート判定に使う。未設定時は常に未ログイン扱い（fail-closed） | `.env` | Parameter Store |
| `SUPABASE_JWT_JWKS_URL` | ES256（JWT Signing Keys）方式の公開鍵配布URL。公開情報のためParameter Storeには置かない。HS256方式なら未設定でよい | `.env`（Supabase Local CLIはこの方式のみ発行するため必須。`host.docker.internal`経由） | Lambda環境変数（Terraform変数`supabase_jwt_jwks_url`） |
| `DATABASE_URL` | 生成履歴を保存するPostgreSQLの接続文字列。RLSを迂回しない`authenticator`ロールで接続する。未設定時は履歴保存を静かにスキップし、`/api/history`は500になる | `.env`（Supabase Local CLIのPostgresへ`host.docker.internal`経由） | Parameter Store |
| `MIGRATION_DATABASE_URL` | alembic専用の接続文字列。テーブル作成・ポリシー定義に所有者権限が要るため`postgres`ロールを使う | `.env` | Lambdaには渡さない。CDのdeployジョブがGitHub Secretsから受け取る |
| `SSM_PARAMETER_PREFIX` | Parameter Storeから秘密情報を取得する際のパス接頭辞。実値未投入のダミー（`PLACEHOLDER_SET_OUT_OF_BAND`）は展開しない | 未設定（`secrets_loader.py`はno-op） | `/adapt-sheet/prod`（Terraform） |
| `DOCLING_SERVICE_URL` | テキスト抽出を委譲するdocling-serviceの接続先 | `http://docling:8100`（compose直書き） | doclingのLambda Function URL（Terraform） |
| `DOCLING_SERVICE_AUTH` | `aws_sigv4`のときSigV4署名を付けて呼ぶ（Function URLがAWS_IAM認証必須のため） | 未設定 | `aws_sigv4`（Terraform） |
| `DOCLING_SERVICE_SKIP_WARMUP` | ウォームアップ時に実convertを叩かずOK扱いにするスイッチ。常時稼働でコールドスタートの無い開発環境向け | `true`（compose直書き） | 未設定 |
| `PDF2HTMLEX_SERVICE_URL` | pdf2htmlex-serviceの接続先 | `http://pdf2htmlex:8200`（compose直書き） | pdf2htmlexのLambda Function URL（Terraform） |
| `PDF2HTMLEX_SERVICE_AUTH` | 同上のSigV4署名スイッチ | 未設定 | `aws_sigv4`（Terraform） |
| `RENDER_JOBS_BUCKET` | 非同期レンダリングジョブ（アップロード済みPDF・結果JSON）の保存先バケット | `render-jobs-local`（MinIO、compose直書き） | S3バケット名（Terraform） |
| `RENDER_JOBS_S3_ENDPOINT_URL` | S3 APIのエンドポイント。未設定時は実AWSのリージョナルエンドポイント | `http://minio:9000` | 未設定 |
| `RENDER_JOBS_S3_PUBLIC_ENDPOINT_URL` | ブラウザへ返すpresigned URLのホスト。コンテナ内のホスト名では到達できないため分ける | `http://localhost:9000` | 未設定 |
| `RENDER_WORKER_FUNCTION_NAME` | 非同期ジョブを処理するrender-worker Lambdaの関数名 | 未設定 | 関数名（Terraform） |
| `RENDER_WORKER_LOCAL_URL` | render-worker Lambdaが存在しない環境で、自身の`/internal/render-jobs/process`へHTTP POSTする際の宛先 | `http://localhost:8000` | 未設定 |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | S3・Lambda呼び出し・SigV4署名に使うリージョン。既定は`ap-northeast-1` | `AWS_REGION=ap-northeast-1`（compose直書き） | Lambdaランタイムが自動設定 |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3互換ストレージの資格情報 | `minioadmin`（MinIO用のローカル固定値、compose直書き） | 未設定（Lambda実行ロールの一時認証情報を使う） |

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（Auth管理API用）はバックエンドのコードからは使わない。ローカルの`scripts/create_user.sh`のみが参照する（2-4参照）。

### 2-3. フロントエンド

| 変数名 | 説明 | 開発 | 本番 |
|---|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase Auth SDKの設定（`lib/supabaseClient.ts`）。未設定時はログインUI（`AuthPanel`）自体を非表示にする | `.env` | GitHub ActionsのVariables / Secrets（ビルド時に埋め込むため、値を変えたら再ビルド・再アップロードが必要） |

APIのベースURLは持たない。SPAとAPIは同一オリジン（CloudFront）から配信し、`src/lib/api.ts`は相対パス`/api/...`のまま本番でも動く。

### 2-4. ローカル開発・ツール専用

本番には存在しない、開発環境だけの変数。

| 変数名 | 説明 | 格納場所 |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `scripts/create_user.sh`がSupabase Auth管理APIでアカウントを作成する際の管理者キー | `.env` |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | Supabase Local CLI（`supabase/config.toml`の`env(...)`参照）で使うGoogle OAuthクライアント。ホスト型プロジェクトには反映されない（2-5参照） | `.env` |
| `GITHUB_TOKEN` | GitHub MCP Server（`.mcp.json`）の認証に使うPersonal Access Token | `.env` |
| `PLAYWRIGHT_TEST_BASE_URL` | E2Eの接続先。起動済みfrontendコンテナへサービス名で疎通する | `docker-compose.yml`（`e2e`サービス） |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` / `MINIO_API_CORS_ALLOW_ORIGIN` | ローカルのS3互換ストレージ（MinIO）の資格情報とCORS許可オリジン | `docker-compose.yml`（`minio`サービス） |
| `HF_HUB_DISABLE_XET` | doclingのモデルダウンロードをhf-xet経路ではなく標準HTTPSへフォールバックさせる | `docker-compose.yml`（`docling`サービス） |
| `PWD` | Zed向けLSPサービスがホストと同じ絶対パスでリポジトリをマウントするために参照する | シェルが自動設定 |

### 2-5. Supabase AuthのGoogleプロバイダ（ホスト型プロジェクト）

`supabase/config.toml`の`[auth.external.google]`はローカルCLI（`supabase start`）にのみ適用され、ホスト型（本番）Supabaseプロジェクトには反映されない。本番でGoogleログインを使うには、Supabaseダッシュボード側で個別に設定が必要。

1. Google Cloud ConsoleのOAuthクライアントに、本番用の認可済みリダイレクトURIを追加する: `https://<project-ref>.supabase.co/auth/v1/callback`（Supabaseダッシュボードの「Callback URL (for OAuth)」欄に表示される値をそのまま使う）
2. Supabaseダッシュボード → 対象プロジェクト → Authentication → Providers → Google を有効化し、Client ID / Secretを設定する。
3. Supabaseダッシュボード → Authentication → URL Configuration で、**Site URL**を本番フロントエンドURL（CloudFrontドメイン）に、**Redirect URLs**にも同URLを追加する。未設定のままだとログイン自体は成功するが、初期値の`http://localhost:3000`へ`?code=...`付きでリダイレクトされてしまう（ローカル開発用のURLはそのまま残してよい）。
4. `https://<project-ref>.supabase.co/auth/v1/settings` を叩き、`external.google: true`になっているか確認する。

1〜3はSupabase側（GoTrueサーバー）の設定であり、フロントエンドの再ビルド・再デプロイなしに即時反映される。未設定のままだとフロントの`signInWithOAuth({ provider: 'google' })`が`{"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`で失敗する。

---

## 3. バックエンドのコンテナ化

1. 本番用`backend/Dockerfile.lambda`に`AWS Lambda Web Adapter`のバイナリを`COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:...`で追加（開発用`backend/Dockerfile`とは別ファイル。イメージ名は`aws-lambda-adapter`で`web`は付かない）。
2. APIキーはイメージに焼き込まず、`SSM_PARAMETER_PREFIX`を設定してParameter Store（SecureString）から実行時に取得する。取得はLambdaのコールドスタート時（`app/secrets_loader.py`のグローバルスコープ呼び出し）に一度だけ行い、ハンドラ内では毎リクエストSSMを叩かない。
3. イメージは**ECR Private（`<account>.dkr.ecr.<region>.amazonaws.com`）**へpushする（Lambdaのコンテナイメージは同一リージョンのECR Privateからのみ取得できるため。無料枠500MBの逼迫はライフサイクルポリシーで抑える）。
4. コンテナ内で`pytest`を実行し、環境依存なくテストがパスすることを確認。

`docling-service`/`pdf2htmlex-service`も同様に本番用`Dockerfile.lambda`を持つ（Web Adapterバイナリの導入以外は開発用Dockerfileと同じ）。ただしこの2サービスはbackendからのみ呼ばれる内部専用サービスのため、API Gatewayではなく**AWS_IAM認証必須のLambda Function URL**として公開し、backend Lambdaの実行ロールのみに呼び出しを許可する。backendは`app/services/remote_extractor.py`でリクエストをAWS SigV4署名してから呼び出す（環境変数`DOCLING_SERVICE_AUTH`/`PDF2HTMLEX_SERVICE_AUTH=aws_sigv4`で有効化）。

---

## 4. インフラのコード化

Terraform定義は [`../infra/`](../infra/) に配置する（使い方は [`infra/README.md`](../infra/README.md)）。

- モジュール構成（`infra/modules/`）
  - `frontend`: CloudFront + S3（非公開バケット＋OAC、SPAフォールバック）
  - `lambda`: Lambda関数の共通モジュール。`backend`（入口エンドポイント、メモリ4GB既定、SSM読み取り＋SSM経由KMS復号の最小権限）、`render-worker`（backendと同じイメージを再利用する生成AI系engine専用の非同期ワーカー。API Gateway/Function URLを持たず、backendからの`lambda:invoke`のみ受け付ける。タイムアウト180秒）、`docling`/`pdf2htmlex`（内部専用、AWS_IAM認証Function URL、backend・render-worker双方から呼び出し許可）の4関数で共用する
  - `job_bucket`: 非同期レンダリングジョブのPDF・結果置き場となるS3バケット。1日で自動失効するライフサイクルルールと、ブラウザから署名付きURLへ直接PUTするためのCORS設定を持つ
  - `api_gateway`: REST API（REGIONAL）→ backend Lambdaプロキシ。docling/pdf2htmlex/render-workerはAPI Gatewayを経由しない。ステージ単位のスロットリング（`aws_api_gateway_method_settings`）で過度なAPIコールを防ぐ（WAFは使わない）
  - `ecr`: backend/docling/pdf2htmlexそれぞれのコンテナイメージ用ECR Private（Lambdaは同一リージョンのPrivateからのみ取得可。ライフサイクルで容量抑制。render-workerはbackendと同じECRリポジトリ・イメージを使う）
  - `ssm`: APIキーのSecureString（枠のみ。実値はTerraform管理外で投入）
  - `monitoring`: CloudWatchアラーム（Lambdaのエラー/スロットル、API Gatewayの4XX/5XX、アプリログのERRORメトリクスフィルタ）と通知先のSNSトピック
  - `github_oidc`: GitHub ActionsのOIDCプロバイダとCD用デプロイロール。長期の静的アクセスキーは発行せず、許可したリポジトリ・ブランチのワークフローだけがロールを引き受けられる
- state土台は `infra/bootstrap`（S3バケット＋ロック用DynamoDB）。chicken-egg回避のためローカルstateで最初にapplyする。

---

## 5. CI/CD

- **CI**: `.github/workflows/ci.yml` が、PR作成時・mainマージ時にバック（pytest/ruff）・フロント（Vitest/ESLint/vite build）の2ジョブを自動実行する。ローカル開発と同じ`docker-compose.yml`のサービス定義を使い、ローカル/CIの実行結果を乖離させない。
- 「CIが100%成功しなければマージ不可」はBranch Protection Ruleに設定済み（[CLAUDE.md](../CLAUDE.md) のGit/CI運用ルール参照）。必須チェックは`backend` / `frontend` の2ジョブ。
- docling/pdf2htmlexはコア機能（AI生成・リアルタイムプレビュー）への影響が小さいためCIに含めず、変更時は`docker compose exec docling/pdf2htmlex pytest`で手動検証する。
- **CD**: `.github/workflows/cd.yml` が、mainへのpush（＝マージ）と手動実行で本番へデプロイする。AWSの長期アクセスキーは持たず、OIDC（`infra/modules/github_oidc`）で発行される短期認証情報でデプロイロールを引き受ける。

### CDの流れ

`plan` → `build`（3サービス並列） → `deploy` の3ジョブで構成する。

1. **plan**: 各サービスのイメージタグを決める。タグは「そのサービスのビルドコンテキスト（`backend` / `docling-service` / `pdf2htmlex-service`）を最後に変更したコミットのSHA」で、`git log -1 --format=%H -- <ctx>` で求める。
2. **build**（3サービス並列）: そのタグのイメージがECRに既にあれば何もしない。無ければ`Dockerfile.lambda`からビルドしてECR Privateへpushする。
3. **deploy**: `backend`イメージで`alembic upgrade head`を実行して本番DBのスキーマを最新化する（デプロイ前に適用し、新しいコードが存在しないテーブルへアクセスする事故を防ぐ）。
4. `terraform apply`（`image_tag`等に手順1のタグを渡す）でインフラを適用し、Lambdaを新しいイメージへ更新。変更のなかったサービスはタグも変わらないためLambdaの更新自体が発生しない。
5. `POST /api/warmup` をバックグラウンドで叩き始める。Lambdaのイメージを差し替えた直後はdoclingのコールドスタート（ML推論の初期化）だけで1分以上かかるため、次の手順の裏で先に起こしておく。
6. フロントをビルドしてS3へ同期し、CloudFrontのキャッシュを無効化。`index.html`だけキャッシュさせず、ハッシュ付きアセットは長期キャッシュする。
7. `POST /api/warmup` でbackend→docling/pdf2htmlex/DBの疎通をスモークテストする。手順5で起動済みのため通常は1回目で通る。

> タグをデプロイ時のコミットSHAではなくサービス単位にしているのは、変更のないサービスのビルドとpushを丸ごと省くため。`pip install`等が生成するレイヤーはビルドのたびに別ダイジェストになり、中身が同じでもpushで数GBを再送してしまう（doclingのpushだけで約5分かかっていた）。使用中のイメージは常に各リポジトリの最新なので、ECRライフサイクル（最新5件保持）で消えることはない。

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
- **ログ・アラームの確認**: 障害時にどのログをどう引くかは [observability.md](./observability.md) に手順をまとめている。アラームはSNSトピック（`terraform output alarm_topic_arn`）へ集約され、`alarm_email` を設定した場合は**購読確認メールのリンクを踏むまで通知が届かない**点に注意。
- **ログの保持期間**: `log_retention_in_days`（既定30日）がLambda・API Gateway・CloudFrontのログへ一括で適用される。伸ばすほどCloudWatch Logs / S3の保管料が増える。

---

## 7. 本番環境のリソース

リージョンは`ap-northeast-1`。`terraform output`の主な値（AWSアカウントIDはリポジトリが公開のため`<account_id>`に置き換える）:

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
