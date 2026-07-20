# デプロイ・運用手引き

`adapt-sheet` のデプロイ手順・環境変数設定・運用ルールをまとめる。インフラ構成の背景は [`architecture.md`](./architecture.md)、技術選定理由は [`decisions.md`](./decisions.md) を参照。

> フェーズ4（インフラ構築）着手前の暫定版。Terraform/GitHub Actionsの実装が進み次第、実コマンド・実際の変数名で更新する。

---

## 1. デプロイ全体フロー

1. PRを作成し、GitHub ActionsのCI（Vitest / pytest / ESLint / Ruff）が全て成功することを確認。
2. レビュー後、mainブランチへマージ（Branch Protection Ruleにより直接pushは不可）。
3. マージをトリガーにGitHub ActionsのCDが起動し、Terraformでインフラを適用、S3・Lambdaへ自動デプロイ。
4. デプロイ後、ステージングエンドポイントに対する疎通テストを実行。

詳細なCI/CD概要図は [`architecture.md`](./architecture.md#4-cicd概要図) を参照。

---

## 2. 環境変数

### バックエンド（Lambda / ローカル共通）

| 変数名 | 説明 | 備考 |
|---|---|---|
| `GEMINI_API_KEY` | Gemini API（Google AI Studio）利用のためのAPIキー | `USE_MOCK_AI=false`のときのみ必須（[CLAUDE.md](../CLAUDE.md)参照） |
| `USE_MOCK_AI` | AI呼び出しをモック層に固定するかどうかのスイッチ | 未設定時は`true`扱い（モック）。`false`の場合のみ`engine`に応じた実経路を呼び出す（ADR-006） |
| `GEMINI_MODEL` | 使用するGeminiモデル | 未設定時は`gemini-2.5-flash`。無料枠の日次クォータはモデル単位のため、上限到達時の切り替えに使う（ADR-014） |
| `LOG_AI_PAYLOAD` | Geminiへの入力プロンプト全文・出力全文をログへ出すかどうかのスイッチ | 未設定時は`false`扱い（出力しない）。`true`/`1`/`yes`で有効。プロンプトには帳票の業務データが含まれるため、本番では有効化しない（ADR-011） |
| `SSM_PARAMETER_PREFIX` | Parameter StoreからAPIキーを取得する際のパス接頭辞（例: `/adapt-sheet/prod`） | Lambda本番でのみ設定。設定時、コールドスタート時に`{prefix}/GEMINI_API_KEY`等を復号取得し`os.environ`へ展開する（ADR-017）。ローカル/pytestでは未設定のため何もしない |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase接続情報（DB統合用） | ステップ28（Supabase/PostgreSQL統合）以降で使用。ローカルは `Supabase Local CLI` の値を使用 |
| `SUPABASE_JWT_SECRET` | Supabase Authが発行するJWTの検証鍵（HS256共有シークレット、SupabaseダッシュボードのJWT Settingsで確認） | `app/services/auth.py`が`/api/render`のゲート判定（`GATED_ENGINES`）に使用。未設定時は常に未ログイン扱い（fail-closed、ADR-018） |

### フロントエンド

| 変数名 | 説明 |
|---|---|
| `VITE_API_BASE_URL` | バックエンドAPIのベースURL（ローカル/ステージング/本番で切替） |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase Auth SDK設定（`lib/supabaseClient.ts`）。未設定時はログインUI（`AuthPanel`）自体を非表示にする（ADR-018） |

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

> 当面のLambda化対象は軽量な`backend`のみ。`docling-service`/`pdf2htmlex-service`のLambda化は後続で対応する（ADR-017）。

理由の詳細は [`decisions.md`](./decisions.md) のADR-017を参照。

---

## 4. インフラのコード化（フェーズ4 ステップ25）

Terraform定義は [`../infra/`](../infra/) に配置する（使い方は [`infra/README.md`](../infra/README.md)）。本ステップは**コード定義まで**で、`terraform apply`（実AWSリソース作成）は未実施。

- モジュール構成（`infra/modules/`）
  - `frontend`: CloudFront + S3（非公開バケット＋OAC、SPAフォールバック）
  - `lambda`: 入口エンドポイント（メモリ4GB既定）。実行ロールはSSM読み取り＋SSM経由KMS復号の最小権限
  - `api_gateway`: REST API（REGIONAL）→ Lambdaプロキシ（WAF関連付けのためHTTP APIではなくREST）
  - `waf`: AWSマネージドルール＋IPレート制限。API Gatewayステージへ関連付け
  - `ecr`: backendコンテナイメージのECR Private（Lambdaは同一リージョンのPrivateからのみ取得可。ライフサイクルで容量抑制）
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
- **レート制限**: 未認証エリアはIP単位、認証エリアはユーザーID単位でAWS WAFのレート制限を設定・監視する（[architecture.md](./architecture.md#3-セキュリティ概要図) 参照）。
- **ロールバック**: Terraform管理下のため、問題発生時は直前のTerraform state / GitHub Actionsのデプロイ履歴から切り戻す。

---

## 7. 今後の追記予定

- フェーズ4のTerraform実装完了後、実際の`terraform apply`手順・モジュール構成を追記する。
- フェーズ5のSupabase統合完了後、実際の環境変数値の取得手順（ダッシュボードのどこを見るか等）を追記する。
