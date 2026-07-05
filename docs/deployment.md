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
| `ANTHROPIC_API_KEY` | Claude API利用のためのAPIキー | ローカルではモック層を経由するため未設定でも動作（[CLAUDE.md](../CLAUDE.md) 参照） |
| `DOCLING_SERVE_ARTIFACTS_PATH` | Doclingモデルの焼き込み先絶対パス | コンテナ内で完全オフライン動作させるために必須 |
| `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` | Auth0テナント情報 | フェーズ5以降で使用 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase接続情報 | フェーズ5以降で使用。ローカルは `Supabase Local CLI` の値を使用 |

### フロントエンド

| 変数名 | 説明 |
|---|---|
| `VITE_API_BASE_URL` | バックエンドAPIのベースURL（ローカル/ステージング/本番で切替） |
| `VITE_AUTH0_DOMAIN` / `VITE_AUTH0_CLIENT_ID` | Auth0 SDK設定（フェーズ5以降） |

### ClaudeCode / MCP

| 変数名 | 説明 | 備考 |
|---|---|---|
| `GITHUB_TOKEN` | GitHub MCP Server（`.mcp.json`）の認証に使用するPersonal Access Token | ローカルでは `.env`（gitignore対象）に設定し、`.envrc` + `direnv` での自動読み込みを想定（`direnv` 未導入の場合は手動で `export` する） |

機密情報（APIキー等）はリポジトリにコミットせず、GitHub ActionsのSecretsおよびAWS Systems Manager Parameter Store等で管理する。

---

## 3. バックエンドのコンテナ化（フェーズ4 ステップ9）

1. Dockerfileに`AWS Lambda Web Adapter`のバイナリを追加。
2. ビルド時に`docling-tools models download`を実行し、Doclingモデルをコンテナに焼き込む。
3. `DOCLING_SERVE_ARTIFACTS_PATH`を焼き込んだ絶対パスに設定。
4. コンテナ内で`pytest`を実行し、環境依存なくテストがパスすることを確認。

理由の詳細は [`decisions.md`](./decisions.md#adr-004-aws-lambda-web-adapter--モデル事前焼き込みでコールドスタート対策) を参照。

---

## 4. インフラのコード化（フェーズ4 ステップ10）

- Terraformで以下を定義・構築する。
  - フロントエンド: CloudFront + S3
  - バックエンド: Lambda（メモリ4GB〜8GB推奨） + API Gateway
  - セキュリティ: AWS WAF
- AWS認証はOIDC等の安全な方式でGitHub Actionsから利用する（長期の静的アクセスキーは発行しない）。
- デプロイ後、ステージング環境のエンドポイントに対してローカルからAPIテストを実行し疎通を確認する。

---

## 5. CI/CDの構築（フェーズ4 ステップ11）

- PR作成時・mainマージ時にフロント（Vitest）・バック（pytest）・静的解析（ESLint/Ruff）を自動実行するワークフローを構築する。
- 「CIが100%成功しなければマージ不可」をBranch Protection Ruleに設定する（[CLAUDE.md](../CLAUDE.md) のGit/CI運用ルール参照）。
- テスト成功後、AWS（S3 / Lambda）への自動デプロイを構築する。

---

## 6. 運用時の注意点

- **Doclingモデルの更新**: モデルバージョンを上げる場合は、コンテナ再ビルド＋焼き込みが必須（起動時ダウンロードには戻さない）。
- **レート制限**: 未認証エリアはIP単位、認証エリアはユーザーID単位でAWS WAFのレート制限を設定・監視する（[architecture.md](./architecture.md#3-セキュリティ概要図) 参照）。
- **ロールバック**: Terraform管理下のため、問題発生時は直前のTerraform state / GitHub Actionsのデプロイ履歴から切り戻す。

---

## 7. 今後の追記予定

- フェーズ4のTerraform実装完了後、実際の`terraform apply`手順・モジュール構成を追記する。
- フェーズ5のAuth0/Supabase統合完了後、実際の環境変数値の取得手順（ダッシュボードのどこを見るか等）を追記する。
