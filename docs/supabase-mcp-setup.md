# Supabase MCP（`@supabase/mcp-server-supabase`）セットアップ・ログイン手順

フェーズ5（Supabase Auth・PostgreSQL統合）に着手する前に導入する、Supabaseの
プロジェクト・スキーマ・Authを操作できる公式MCPサーバー
[`@supabase/mcp-server-supabase`](https://github.com/supabase-community/supabase-mcp)
のセットアップと、毎回のログイン手順をまとめる。生成AIはこのMCPを通じて、
Supabaseプロジェクトの作成・マイグレーション適用・テーブル閲覧などを実行できる。

- **認証方式**: Supabaseダッシュボードで発行する**Personal Access Token（PAT）**。
  `aws login`のような一時認証情報ではなく、明示的に無効化するまで有効な長期トークン。
- **実行方式**: `npx`（[AWS CLI MCP](./aws-mcp-setup.md)・`playwright`と異なりDockerイメージではない。
  公式配布形態が npm パッケージのため、既存の2サーバーとは実行方式を揃えていない）。
  フロントエンドの開発でNode.js/npxは既に前提環境のため、追加導入は不要。

---

## 前提

- Node.js（`npx`が使えること）。フロントエンド開発（`docker compose exec frontend ...`）とは別に、
  MCPはホスト側のClaude Codeプロセスから起動するため、**ホストにNode.jsが必要**。
- Supabaseアカウントを保有していること（フェーズ5で使う組織・プロジェクトは未作成でよい）。

---

## 初回のみのセットアップ（環境ごとに1回）

> 2回目以降の環境や、再構築時のみ実施する。日常のトークン更新は次章「毎回の確認」を参照。

### 1. Personal Access Tokenを発行

1. [Supabaseダッシュボード](https://supabase.com/dashboard/account/tokens) にサインインする。
2. `Generate new token` からトークンを発行する（名称は `adapt-sheet-mcp` 等、用途が分かるものにする）。
3. 発行直後にしか表示されないため、その場でコピーする。

### 2. `.mcp.json` に `supabase` サーバーを定義

リポジトリの `.mcp.json` に以下を追加する（本リポジトリでは追加済み）。

```json
"supabase": {
  "command": "npx",
  "args": ["-y", "@supabase/mcp-server-supabase@latest"],
  "env": {
    "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}"
  }
}
```

- `--project-ref=<ref>` は付けていない（フェーズ5でSupabaseプロジェクトを新規作成する想定のため、
  現時点では組織単位の操作（`list_organizations`/`create_project`等）が必要）。
  プロジェクト作成後は、対象プロジェクトへのアクセスを限定するため `--project-ref` の追加を検討する。
- `--read-only` も付けていない（プロジェクト作成・マイグレーション適用など書き込み操作がフェーズ5の
  本来の用途のため）。破壊的操作の前に確認したい場合は、一時的に `--read-only` を引数へ追加し、
  必要な操作の直前だけ外す運用にする。

### 3. トークンをシェル環境変数として保存

`~/.aws/login/cache`のような自動更新の仕組みは無いため、トークンをシェルの環境変数として
設定しておく（`.zshrc`/`.bashrc`等、リポジトリ外に保存すること）。

```bash
export SUPABASE_ACCESS_TOKEN="sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

> **重要**: このトークンはコミットしない。`.mcp.json`には`${SUPABASE_ACCESS_TOKEN}`という
> 変数参照のみが入り、実際の値はホストの環境変数から解決される。

---

## 毎回の確認（トークンは自動失効しない）

AWS CLI MCPの`aws login`のようなセッション更新は不要。トークンはSupabase側で明示的に
無効化（Revoke）するまで有効なため、シェル起動時に環境変数が設定されていることだけ確認すればよい。

```bash
echo "${SUPABASE_ACCESS_TOKEN:+set}"   # "set" と表示されれば環境変数が読み込まれている
```

トークンを失効させたい場合は、ダッシュボードの
[Access Tokens](https://supabase.com/dashboard/account/tokens) から `Revoke` する。

---

## 動作確認

Claude Codeを再起動し、`supabase`サーバーが起動していることを確認したうえで、
MCPツール（`list_organizations`等、組織一覧を返す読み取り専用ツール）を一度呼び出し、
自分のSupabase組織が返ってくることを確認する（フェーズ5でプロジェクトを作成する前段確認として十分）。

---

## Claude Code での有効化

`.mcp.json` の変更を取り込んだ後、Claude Codeを再起動すると新しい `supabase` サーバーの
起動許可を求められるので承認する（`.claude/settings.local.json` の `enabledMcpjsonServers` に
`supabase` を加える運用でもよい）。承認後、Supabase関連のMCPツールが利用可能になる。

---

## トラブルシュート

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| MCPツール呼び出しで認証エラー | `SUPABASE_ACCESS_TOKEN` が未設定、またはトークンがRevoke済み | シェルで環境変数を確認し、必要ならダッシュボードで再発行 |
| `npx`実行が遅い/失敗する | パッケージの初回ダウンロード、またはNode.js未導入 | ホストに Node.js を導入する（`brew install node` 等） |
| 組織・プロジェクトが1件も返らない | トークンを発行したアカウントと対象組織が異なる | ダッシュボードで対象組織にログインしているアカウントのトークンを再発行 |

---

## セキュリティ上の注意

- 発行したPersonal Access Tokenは**組織全体**（未作成のプロジェクトの新規作成も含む）に対する
  権限を持つ。AWSの一時認証情報と異なり自動失効しないため、誤ってチャットやコードに貼った場合は
  即座にダッシュボードから`Revoke`する。
- トークンはリポジトリ内のいかなるファイルにも直書きしない（`.mcp.json`は変数参照のみ）。
- フェーズ5でプロジェクトを作成した後は、`--project-ref`でスコープを絞り、影響範囲を
  対象プロジェクトのみに限定することを検討する。
