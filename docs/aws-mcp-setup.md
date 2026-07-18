# AWS CLI MCP（`aws-api-mcp-server`）セットアップ・ログイン手順

フェーズ4のインフラ構築で使う、AWS CLIを汎用的に実行できる公式MCPサーバー
[`awslabs.aws-api-mcp-server`](https://awslabs.github.io/mcp/servers/aws-api-mcp-server) の
セットアップと、毎回のログイン手順をまとめる。生成AIは MCP ツール `call_aws` を通じて
AWS CLI コマンドを実行できる（リソースの作成・変更・削除まで可能）。

- **認証方式**: 長期アクセスキーは発行せず、AWS CLI v2 の `aws login`（コンソール認証情報・2025年11月GA）で
  一時認証情報を取得する。取得した認証情報は `~/.aws/login/cache` に保存され、最大12時間自動更新される。
- **実行方式**: Docker（既存の `playwright` MCP と同方式）。`${HOME}/.aws` をコンテナへマウントし、
  コンテナ内の `botocore` が `login` 認証プロバイダで一時認証情報をネイティブに解決する。

---

## 前提

- Docker が起動していること。
- AWS マネジメントコンソールにサインインできること（root / IAM ユーザー / フェデレーション）。
  - IAM ユーザーの場合、`SignInLocalDevelopmentAccess` マネージドポリシーのアタッチが必要（root は不要）。

---

## 初回のみのセットアップ（環境ごとに1回）

> 2回目以降の環境や、再構築時のみ実施する。日常のログインは次章「毎回のログイン」を参照。

### 1. AWS CLI v2 を導入（`aws login` は v2.32.0 以上が必須）

```bash
brew install awscli
aws --version   # aws-cli/2.32.0 以上であることを確認
```

### 2. `.mcp.json` に `aws` サーバーを定義

リポジトリの `.mcp.json` に以下を追加する（本リポジトリでは追加済み）。

```json
"aws": {
  "command": "docker",
  "args": [
    "run", "-i", "--rm", "--init", "--pull=always",
    "--env", "AWS_REGION=ap-northeast-1",
    "--env", "AWS_API_MCP_PROFILE_NAME=adapt-sheet",
    "--volume", "${HOME}/.aws:/app/.aws",
    "public.ecr.aws/awslabs-mcp/awslabs/aws-api-mcp-server:latest"
  ]
}
```

- `READ_OPERATIONS_ONLY` は設定しない（デフォルト＝作成・変更・削除を許可）。
  書き込み前に都度確認したい場合は `--env REQUIRE_MUTATION_CONSENT=true` を `args` に追加する。

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

ログイン後、次の3段で疎通確認する（すべて成功すれば MCP から AWS を操作できる）。

```bash
# 1. ホスト: TYPE が login になり、正しいアカウントが返ること
aws sts get-caller-identity --profile adapt-sheet
aws configure list --profile adapt-sheet      # access_key/secret_key の TYPE 列が login

# 2. MCP コンテナ: マウントした ~/.aws から login セッションを解決できること
docker run --rm \
  --env AWS_API_MCP_PROFILE_NAME=adapt-sheet \
  --volume "$HOME/.aws:/app/.aws" \
  --entrypoint aws \
  public.ecr.aws/awslabs-mcp/awslabs/aws-api-mcp-server:latest \
  sts get-caller-identity --profile adapt-sheet
```

MCP ツール `call_aws` 単体で確かめたい場合は、サーバーを stdio 起動して
`tools/call`（`name=call_aws`, `arguments={"cli_command":"aws sts get-caller-identity"}`）を
送り、`status_code: 200` が返ることを確認する。

---

## Claude Code での有効化

`.mcp.json` の変更を取り込んだ後、Claude Code を再起動すると新しい `aws` サーバーの
起動許可を求められるので承認する（`.claude/settings.local.json` の `enabledMcpjsonServers` に
`aws` を加える運用でもよい）。承認後、`call_aws` / `suggest_aws_commands` が利用可能になる。

---

## トラブルシュート

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| `aws login` 後も `ExpiredToken` / `AccessDenied` | `~/.aws/credentials` の静的キーが `login` より優先されている | `aws configure list` で TYPE を確認し、静的キーを削除（credentials を空に） |
| ブラウザが開かない / コールバックが弾かれる | ファイアウォールが OAuth コールバックポートを遮断 | `aws login --profile adapt-sheet --remote` を使う |
| コンテナで認証情報が解決されない | `~/.aws` がマウントされていない / プロファイル名不一致 | `--volume ${HOME}/.aws:/app/.aws` と `AWS_API_MCP_PROFILE_NAME=adapt-sheet` を確認 |
| `aws login` が無い（unknown command） | AWS CLI が v2.32.0 未満、または v1 | `brew upgrade awscli` で v2.32.0 以上へ |

---

## セキュリティ上の注意

- 長期アクセスキー（`AKIA...` + シークレット）は発行・保存しない。誤ってチャットやコードに貼った場合は
  即座に IAM で無効化する。
- 一時認証情報（`~/.aws/login/cache`）や `~/.aws/credentials` はコミットしない（`.gitignore` 済みのホーム配下）。
- `call_aws` はリソース削除まで実行できる。破壊的操作の前は対象と影響範囲を確認する。
