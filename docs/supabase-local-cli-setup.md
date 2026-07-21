# Supabase Local CLIによるログイン機能のローカル検証手順

ステップ27で実装したSupabase Auth（email/passwordログイン）を、実際のクラウドプロジェクトを
作成せずにローカルだけで検証するための手順（ADR-020）。`docs/supabase-mcp-setup.md`の
Supabase MCP（生成AIからのプロジェクト操作用）とは別物で、こちらは`supabase` CLIコマンドで
Postgres・GoTrue（Auth）等のスタックをDockerコンテナとしてローカルに起動する。

- **対象範囲**: ログイン・新規登録・ゲート対象エンジン（Gemini標準/Claude/OpenAI）・
  `GET /api/history`の動作検証のみ。生成履歴（`render_history`）の保存先は引き続き
  `docker-compose.yml`の`db`サービス（ADR-019）であり、Supabase Local CLIのPostgresとは
  別物（統合しない）。
- **前提**: `docker compose up --build`でアプリ自体は起動済みであること。

---

## 1. Supabase CLIの導入（初回のみ）

```bash
brew install supabase/tap/supabase
supabase --version
```

## 2. ローカルスタックの起動

リポジトリルートで実行する（`supabase/config.toml`は導入済み。ワークツリーごとに
`supabase init`をやり直す必要はない）。

```bash
supabase start
```

初回はDockerイメージのpullが発生し数分かかる。完了すると`API_URL`（既定
`http://127.0.0.1:54321`）・`ANON_KEY`・`JWT_SECRET`等が表示される。これらはSupabase CLIが
毎回同じ値を発行するローカル開発専用の既定値であり、本番のSupabase資格情報とは異なる
（`Local dev security notice`の通り、ローカル専用でネットワークに公開されるため本番情報を
混ぜないこと）。表示された値を忘れた場合は`supabase status`で再表示できる。

## 3. `.env`への設定

プロジェクトルートの`.env`（Git管理外）に以下を追記する。値は`supabase start`/`supabase status`
の出力をそのまま使う。

```bash
# ブラウザから直接アクセスするため127.0.0.1のまま（Docker内部DNSを経由しない）
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<supabase status の ANON_KEY>
# 従来のHS256共有シークレット方式のSupabaseプロジェクト用（Local CLIでは実際には未使用だが、
# 本番プロジェクトが旧方式のままの場合に備えて設定しておく。app/services/auth.py、ADR-018）
SUPABASE_JWT_SECRET=<supabase status の JWT_SECRET>
# Supabase Local CLIが既定で使うJWT Signing Keys（ES256/JWKS）方式の検証に必要（ADR-020）。
# backendコンテナからDocker Desktopのホストブリッジ経由でSupabase CLIのコンテナへ到達する。
SUPABASE_JWT_JWKS_URL=http://host.docker.internal:54321/auth/v1/.well-known/jwks.json
```

設定後、backend/frontendコンテナを再作成して環境変数を反映する（`docker compose restart`では
`.env`の再読み込みが行われないため、`up -d`で作り直す）。

```bash
docker compose up -d backend frontend
```

## 4. 生成履歴用DBのマイグレーション適用（未適用の場合）

`GET /api/history`・自動保存の検証には`render_history`テーブルが必要（ADR-019）。

```bash
docker compose exec backend alembic upgrade head
```

## 5. 動作確認

1. http://localhost:5173 を開き、ヘッダーの「ログイン」→「新規登録」から任意のメールアドレス・
   パスワード（6文字以上）で登録する。ローカルではメール確認が無効化されているため
   （`supabase/config.toml`の`auth.email.enable_confirmations = false`）、送信後すぐにログイン
   状態になる。
2. `EngineSelect`でGemini標準/Claude/OpenAIを選択して描画できる（未ログイン時は403
   `FREE_ACCESS_FORBIDDEN`になっていたことと比較する）。
3. 描画に成功すると生成履歴が自動保存される。保存内容はAPIで確認できる（画面上の履歴閲覧UIは
   未実装。ADR-019のトレードオフ）。

```bash
TOKEN=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: <ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"<登録したメールアドレス>","password":"<パスワード>"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s http://localhost:8000/api/history -H "Authorization: Bearer $TOKEN"
```

## 6. 停止・後片付け

日常の`docker compose down`はSupabase CLIのスタックには影響しない（別管理のため）。
Supabase Local CLI側を止める場合は以下を実行する。

```bash
supabase stop
```

データを含めて完全にリセットしたい場合（登録したテストユーザーを消したい場合等）は
`supabase stop --no-backup`、またはボリュームごと削除する`supabase stop --backup=false`を使う
（Supabase CLIのバージョンによりオプション名が異なる場合があるため`supabase stop --help`で確認）。

---

## トラブルシュート

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| ログイン後もゲート対象エンジンが403のまま | `SUPABASE_JWT_JWKS_URL`未設定、または`host.docker.internal`にbackendコンテナから到達できない | `.env`の設定を確認し、`docker compose exec backend curl http://host.docker.internal:54321/auth/v1/.well-known/jwks.json`で疎通確認する |
| `GET /api/history`が500 | `render_history`テーブル未作成（マイグレーション未適用） | `docker compose exec backend alembic upgrade head`を実行する |
| ヘッダーにログインボタンが出ない | `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`未設定のままfrontendが起動している | `.env`設定後に`docker compose up -d frontend`でコンテナを作り直す |
| `supabase start`が失敗・固まる | 初回のDockerイメージpullに時間がかかっている、またはポート（54321-54324等）が競合している | しばらく待つ。競合時は`supabase/config.toml`でポート番号を変更する |

---

## セキュリティ上の注意

- `supabase start`が発行する`ANON_KEY`/`JWT_SECRET`等はSupabase CLIの**公開されたデモ値**であり、
  秘匿情報ではない（Supabase公式ドキュメントにも同じ値が掲載されている）。ただし本番のSupabase
  プロジェクトの値と混同してコミットしないこと（`.env`はGit管理外）。
- ローカルスタックは`0.0.0.0`にバインドされ、Studio等に認証がない（`supabase start`実行時の
  `Local dev security notice`参照）。開発機以外のネットワークに公開しない環境で使うこと。
