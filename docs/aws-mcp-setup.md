# AWS MCP Server セットアップ・ログイン手順

フェーズ4のインフラ構築で使う、AWS CLIを汎用的に実行できるAWSマネージドのMCPサーバー
[AWS MCP Server](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/getting-started-aws-mcp-server.html)
のセットアップと、毎回のログイン手順をまとめる。生成AIは MCP ツール `aws___call_aws` /
`aws___run_script` 等を通じて AWS API を実行できる（リソースの作成・変更・削除まで可能）。

- **認証方式**: 長期アクセスキーは発行せず、AWS CLI v2 の `aws login`（コンソール認証情報・2025年11月GA）で
  一時認証情報を取得する。取得した認証情報は `~/.aws/login/cache` に保存され、最大12時間自動更新される。
- **実行方式**: サーバー本体はAWSがホストするマネージドエンドポイント。ローカルでは
  [MCP Proxy for AWS](https://github.com/aws/mcp-proxy-for-aws)（`mcp-proxy-for-aws`）が
  SigV4署名の中継のみを行う。プロキシの実行環境は `mise.toml` で固定した `uv`（`uvx`）。
  複数アカウント運用が不要なため認証方式はSigV4（`--profile`固定）を採用し、
  リージョンを跨いでプロファイルを切り替えるOAuth方式は使わない。

---

## 前提

- AWS マネジメントコンソールにサインインできること（root / IAM ユーザー / フェデレーション）。
  - IAM ユーザーの場合、`SignInLocalDevelopmentAccess` マネージドポリシーのアタッチが必要（root は不要）。
- `mise install` 済みで `uv` / `awscli` がホストに導入されていること。

---

## 初回のみのセットアップ（環境ごとに1回）

> 2回目以降の環境や、再構築時のみ実施する。日常のログインは次章「毎回のログイン」を参照。

### 1. `mise install` で `uv` / AWS CLI を導入

```bash
mise install    # mise.tomlのuv/awscliバージョンを導入
aws --version   # aws-cli/2.32.0 以上であることを確認（aws loginの必須要件）
```

### 2. `.mcp.json` に `aws` サーバーを定義

リポジトリの `.mcp.json` に以下を追加する（本リポジトリでは追加済み）。

```json
"aws": {
  "command": "uvx",
  "timeout": 100000,
  "args": [
    "mcp-proxy-for-aws@1.6.4",
    "https://aws-mcp.us-east-1.api.aws/mcp",
    "--metadata", "AWS_REGION=ap-northeast-1",
    "--profile", "adapt-sheet"
  ]
}
```

- エンドポイントのリージョン（`us-east-1`）はMCPサーバー自体が動くリージョンで、AWS MCP Serverが対応する
  `us-east-1` / `eu-central-1` のいずれかを指定する。実際にAWS操作を行うリージョンは
  `--metadata AWS_REGION=ap-northeast-1` で別途指定する（両者は独立しており一致させる必要はない）。
- 書き込み操作を禁止したい場合はIAMポリシー側で制御する（読み取り専用にしたい場合のみ`--read-only`を追加）。

### 3. プロファイルを用意（`aws login` が `login_session` を書き込む）

```bash
# region と output だけ先に設定しておく（任意）
aws configure set region ap-northeast-1 --profile adapt-sheet
aws configure set output json --profile adapt-sheet
```

`~/.aws/config` は最終的に次の形になる（`login_session` 行は `aws login` 実行時に自動追記される）。

```ini
[profile adapt-sheet]
region = ap-northeast-1
output = json
login_session = arn:aws:iam::<ACCOUNT_ID>:user/<USER>
```

> **重要**: `~/.aws/credentials` に静的アクセスキーを書かないこと。静的キーは `login` より
> 優先され、`ExpiredToken` 等の競合を起こす（後述のトラブルシュート参照）。同ファイルは空でよい。

---

## 毎回のログイン（セッションは最大12時間）

セッション期限（最大12時間）が切れたら、以下を再実行してブラウザ認証し直す。

```bash
aws login --profile adapt-sheet
```

- ブラウザが開き、コンソールのサインイン画面で使用する認証情報を選ぶ。
- リージョンは設定済みのため追加入力は不要。
- 成功すると一時認証情報が `~/.aws/login/cache` に保存される。

ファイアウォールでOAuthコールバックが弾かれる場合は `--remote` を使う（表示URLを別デバイス/ブラウザで開き、認証コードを貼り付け）。

```bash
aws login --profile adapt-sheet --remote
```

サインアウトしたい場合:

```bash
aws logout --profile adapt-sheet   # 特定プロファイル
aws logout --all                    # login を使う全プロファイル
```

---

## 動作確認

ログイン後、次の2段で疎通確認する（すべて成功すれば MCP から AWS を操作できる）。

```bash
# 1. ホスト: TYPE が login になり、正しいアカウントが返ること
aws sts get-caller-identity --profile adapt-sheet
aws configure list --profile adapt-sheet      # access_key/secret_key の TYPE 列が login

# 2. プロキシ経由で疎通できること（SigV4署名がAWS MCP Serverに到達するか）
uvx mcp-proxy-for-aws@1.6.4 https://aws-mcp.us-east-1.api.aws/mcp \
  --metadata AWS_REGION=ap-northeast-1 --profile adapt-sheet
```

MCP ツール `aws___call_aws` 単体で確かめたい場合は、Claude Code上で
「STSの`get-caller-identity`を実行して」のように依頼し、正しいアカウントIDが返ることを確認する。

---

## Claude Code での有効化

`.mcp.json` の変更を取り込んだ後、Claude Code を再起動すると新しい `aws` サーバーの
起動許可を求められるので承認する（`.claude/settings.local.json` の `enabledMcpjsonServers` に
`aws` を加える運用でもよい）。承認後、`aws___call_aws` / `aws___run_script` /
`aws___search_documentation` 等が利用可能になる。

---

## トラブルシュート

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| `aws login` 後も `ExpiredToken` / `AccessDenied` | `~/.aws/credentials` の静的キーが `login` より優先されている | `aws configure list` で TYPE を確認し、静的キーを削除（credentials を空に） |
| ブラウザが開かない / コールバックが弾かれる | ファイアウォールが OAuth コールバックポートを遮断 | `aws login --profile adapt-sheet --remote` を使う |
| プロキシが認証情報を解決できない | プロファイル名不一致、またはセッション期限切れ | `.mcp.json` の `--profile` と `aws configure list --profile adapt-sheet` の一致を確認し、`aws login` をやり直す |
| `aws login` が無い（unknown command） | AWS CLI が v2.32.0 未満、または v1 | `mise install` で `mise.toml` 記載バージョンへ更新 |
| `uvx: command not found` | `mise install` が未実行、またはmiseのshims/PATHが通っていない | `mise install` を実行し、`mise doctor` でPATH設定を確認 |

---

## セキュリティ上の注意

- 長期アクセスキー（`AKIA...` + シークレット）は発行・保存しない。誤ってチャットやコードに貼った場合は
  即座に IAM で無効化する。
- 一時認証情報（`~/.aws/login/cache`）や `~/.aws/credentials` はコミットしない（`.gitignore` 済みのホーム配下）。
- `aws___call_aws` / `aws___run_script` はリソース削除まで実行できる。破壊的操作の前は対象と影響範囲を確認する。
