# デプロイ・運用手引き

`adapt-sheet` のデプロイ手順・環境変数設定・運用ルールをまとめる。インフラ構成の背景は [`architecture.md`](./architecture.md)、技術選定理由は [`decisions.md`](./decisions.md) を参照。

> フェーズ4（インフラ構築）着手前の暫定版。Terraform/GitHub Actionsの実装が進み次第、実コマンド・実際の変数名で更新する。

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
| `GEMINI_MODEL` | 使用するGeminiモデル | 未設定時は`gemini-2.5-flash`。無料枠の日次クォータはモデル単位のため、上限到達時の切り替えに使う（ADR-014） |
| `LOG_AI_PAYLOAD` | Geminiへの入力プロンプト全文・出力全文をログへ出すかどうかのスイッチ | 未設定時は`false`扱い（出力しない）。`true`/`1`/`yes`で有効。プロンプトには帳票の業務データが含まれるため、本番では有効化しない（ADR-011） |
| `SSM_PARAMETER_PREFIX` | Parameter Storeから秘密情報を取得する際のパス接頭辞（例: `/adapt-sheet/prod`） | Lambda本番でのみ設定。設定時、コールドスタート時に`{prefix}/GEMINI_API_KEY`等を復号取得し`os.environ`へ展開する（ADR-017/028）。取得対象は`app/secrets_loader.py`の`_SECRET_ENV_NAMES`（APIキー3種＋`SUPABASE_JWT_SECRET`＋`DATABASE_URL`）。実値未投入のダミー（`PLACEHOLDER_SET_OUT_OF_BAND`）は展開しない。ローカル/pytestでは未設定のため何もしない |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase接続情報（Auth管理API用） | 現時点のバックエンドコードは未使用（JWT検証は`SUPABASE_JWT_SECRET`、DB接続は`DATABASE_URL`が担う）。管理APIを使う機能を追加する際に利用する想定 |
| `SUPABASE_JWT_SECRET` | Supabase Authが発行するJWTの検証鍵（HS256共有シークレット、SupabaseダッシュボードのJWT Settingsで確認） | `app/services/auth.py`が`/api/render`・`/api/history`のゲート判定に使用。未設定時は常に未ログイン扱い（fail-closed、ADR-018）。本番はParameter Store経由で渡す（ADR-029） |
| `SUPABASE_JWT_JWKS_URL` | SupabaseがES256（JWT Signing Keys）を使う場合の公開鍵配布URL | 公開情報のためParameter Storeではなく、Terraform変数`supabase_jwt_jwks_url`経由でLambda環境変数として渡す（ADR-020/028）。HS256方式なら未設定でよい |
| `DATABASE_URL` | 生成履歴を保存するPostgreSQLの接続文字列（`postgresql+psycopg://...`） | `app/db.py`が使用。ローカルはdocker-composeの`db`サービス（Postgres）を指す既定値、本番はSupabaseプロジェクトのPostgres接続文字列をParameter Storeへ投入する（ADR-019/028）。未設定時は`/api/render`の履歴保存を静かにスキップし、`/api/history`は500になる |

### フロントエンド

| 変数名 | 説明 |
|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase Auth SDK設定（`lib/supabaseClient.ts`）。未設定時はログインUI（`AuthPanel`）自体を非表示にする（ADR-018）。ビルド時に埋め込まれるため、値を変えたら再ビルド・再アップロードが必要 |

APIのベースURLは持たない。SPAとAPIは同一オリジン（CloudFront）から配信し、`src/lib/api.ts`は相対パス`/api/...`のまま本番でも動く（ADR-029）。

### ClaudeCode / MCP

| 変数名 | 説明 | 備考 |
|---|---|---|
| `GITHUB_TOKEN` | GitHub MCP Server（`.mcp.json`）の認証に使用するPersonal Access Token | ローカルでは `.env`（gitignore対象）に設定し、`.envrc` + `direnv` での自動読み込みを想定（`direnv` 未導入の場合は手動で `export` する） |

機密情報（APIキー等）はリポジトリにコミットせず、GitHub ActionsのSecretsおよびAWS Systems Manager Parameter Store等で管理する。

---

## 3. バックエンドのコンテナ化（フェーズ4 ステップ24）

1. 本番用`backend/Dockerfile.lambda`に`AWS Lambda Web Adapter`のバイナリを`COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:...`で追加（開発用`backend/Dockerfile`とは別ファイル。イメージ名は`aws-lambda-adapter`で`web`は付かない）。
2. APIキーはイメージに焼き込まず、`SSM_PARAMETER_PREFIX`を設定してParameter Store（SecureString）から実行時に取得する。取得はLambdaのコールドスタート時（`app/secrets_loader.py`のグローバルスコープ呼び出し）に一度だけ行い、ハンドラ内では毎リクエストSSMを叩かない（ADR-017）。
3. イメージは**ECR Private（`<account>.dkr.ecr.<region>.amazonaws.com`）**へpushする（Lambdaのコンテナイメージは同一リージョンのECR Privateからのみ取得できるため。無料枠500MBの逼迫はライフサイクルポリシーで抑える。ADR-017）。
4. コンテナ内で`pytest`を実行し、環境依存なくテストがパスすることを確認。

理由の詳細は [`decisions.md`](./decisions.md) のADR-017を参照。

`docling-service`/`pdf2htmlex-service`も同様に本番用`Dockerfile.lambda`を持つ（Web Adapterバイナリの導入以外は開発用Dockerfileと同じ）。ただしこの2サービスはbackendからのみ呼ばれる内部専用サービスのため、API Gatewayではなく**AWS_IAM認証必須のLambda Function URL**として公開し、backend Lambdaの実行ロールのみに呼び出しを許可する。backendは`app/services/remote_extractor.py`でリクエストをAWS SigV4署名してから呼び出す（環境変数`DOCLING_SERVICE_AUTH`/`PDF2HTMLEX_SERVICE_AUTH=aws_sigv4`で有効化。詳細は[`decisions.md`](./decisions.md)のADR-026）。

---

## 4. インフラのコード化（フェーズ4 ステップ25）

Terraform定義は [`../infra/`](../infra/) に配置する（使い方は [`infra/README.md`](../infra/README.md)）。本ステップは**コード定義まで**で、`terraform apply`（実AWSリソース作成）は未実施。

- モジュール構成（`infra/modules/`）
  - `frontend`: CloudFront + S3（非公開バケット＋OAC、SPAフォールバック）
  - `lambda`: Lambda関数の共通モジュール。`backend`（入口エンドポイント、メモリ4GB既定、SSM読み取り＋SSM経由KMS復号の最小権限）と、`docling`/`pdf2htmlex`（内部専用、AWS_IAM認証Function URL、backendのみ呼び出し許可。ADR-026）の3関数で共用する
  - `api_gateway`: REST API（REGIONAL）→ backend Lambdaプロキシ。docling/pdf2htmlexはAPI Gatewayを経由しない。ステージ単位のスロットリング（`aws_api_gateway_method_settings`）で過度なAPIコールを防ぐ（WAFは使わない。ADR-027）
  - `ecr`: backend/docling/pdf2htmlexそれぞれのコンテナイメージ用ECR Private（Lambdaは同一リージョンのPrivateからのみ取得可。ライフサイクルで容量抑制）
  - `ssm`: APIキーのSecureString（枠のみ。実値はTerraform管理外で投入）
- state土台は `infra/bootstrap`（S3バケット＋ロック用DynamoDB）。chicken-egg回避のためローカルstateで最初にapplyする。
- AWS認証はOIDC等の安全な方式でGitHub Actionsから利用する（長期の静的アクセスキーは発行しない）。OIDCプロバイダ/デプロイロールはステップ26で定義する。
- デプロイ後、ステージング環境のエンドポイントに対してローカルからAPIテストを実行し疎通を確認する。

---

## 5. CI/CDの構築（フェーズ4 ステップ26）

- **CI（構築済み）**: `.github/workflows/ci.yml` が、PR作成時・mainマージ時にフロント（Vitest/ESLint/vite build）・バック（pytest/ruff）・docling/pdf2htmlex（pytest/ruff）をジョブ分割で自動実行する。ローカル開発と同じ`docker-compose.yml`のサービス定義を使い、ローカル/CIの実行結果を乖離させない。
- 「CIが100%成功しなければマージ不可」をBranch Protection Ruleに設定する（[CLAUDE.md](../CLAUDE.md) のGit/CI運用ルール参照）。CIワークフローが実際にGitHub上で走った実績ができてから設定する（別途対応）。
- **CD（未構築）**: OIDCによるAWS認証設定・`terraform apply`・テスト成功後のAWS（S3 / Lambda）への自動デプロイは別途構築する。

---

## 6. 運用時の注意点

- **APIキーのローテーション**: Parameter Store（SecureString）の値を更新後、Lambdaの実行環境を入れ替える（新デプロイ or 再デプロイ）ことで、次のコールドスタート時に新しいキーが読み込まれる（ADR-017。キャッシュはコールドスタート単位）。
- **レート制限**: WAFは使わず、API Gatewayのステージ単位スロットリング（全メソッド合算、認証有無を区別しない）で過度なAPIコールを防ぐ（ADR-027、[architecture.md](./architecture.md#5-セキュリティ概要図) 参照）。
- **ロールバック**: Terraform管理下のため、問題発生時は直前のTerraform state / GitHub Actionsのデプロイ履歴から切り戻す。

---

## 7. 今後の追記予定

- フェーズ4のTerraform実装完了後、実際の`terraform apply`手順・モジュール構成を追記する。
- フェーズ5のSupabase統合完了後、実際の環境変数値の取得手順（ダッシュボードのどこを見るか等）を追記する。
