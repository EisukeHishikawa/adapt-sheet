# Supabase Local CLIによるログイン機能のローカル検証手順

Supabase Auth（ログイン）とPostgres（生成履歴・RLS）を、実際のクラウドプロジェクトを作成せずに
ローカルだけで検証するための手順（ADR-020/021）。`supabase` CLIコマンドで、Postgres・
GoTrue（Auth）等のスタックをDockerコンテナとしてローカルに起動する。

- **対象範囲**: ログイン（メール＋パスワード／Googleアカウント）・ゲート対象エンジン
  （Gemini標準/Claude/OpenAI）・生成履歴の保存と`GET /api/history`・RLSの動作検証。
- **生成履歴の保存先**: Supabase Local CLIが起動するPostgres（ADR-021でSupabase側へ統合。
  かつて`docker-compose.yml`にあった`db`サービスは廃止）。
- **アカウント作成**: 画面からの新規登録は提供しない。`scripts/create_user.sh`（後述）でのみ作成できる。
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
`http://127.0.0.1:54321`）・`ANON_KEY`・`SERVICE_ROLE_KEY`等が表示される。これらはSupabase CLIが
毎回同じ値を発行するローカル開発専用の既定値であり、本番のSupabase資格情報とは異なる
（`Local dev security notice`の通り、ローカル専用でネットワークに公開されるため本番情報を
混ぜないこと）。表示された値を忘れた場合は`supabase status`で再表示できる。

> `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`..._SECRET`が未設定だと警告が出るが、起動自体は成功する
> （Googleログインを押した時点でエラーになる）。Googleログインまで検証する場合は「7. Googleログイン」を参照。

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

# 生成履歴の保存先（ADR-021）。実行時はRLSを迂回しないauthenticatorロール、マイグレーションは
# 所有者権限が要るpostgresロールを使う。
DATABASE_URL=postgresql+psycopg://authenticator:postgres@host.docker.internal:54322/postgres
MIGRATION_DATABASE_URL=postgresql+psycopg://postgres:postgres@host.docker.internal:54322/postgres

# scripts/create_user.sh がAdmin APIを叩くために使う（supabase status の SERVICE_ROLE_KEY）。
SUPABASE_SERVICE_ROLE_KEY=<supabase status の SERVICE_ROLE_KEY>
```

設定後、backend/frontendコンテナを再作成して環境変数を反映する（`docker compose restart`では
`.env`の再読み込みが行われないため、`up -d`で作り直す）。

```bash
docker compose up -d backend frontend
```

## 4. マイグレーションの適用（テーブル作成＋RLS有効化）

```bash
docker compose exec backend alembic upgrade head
```

`render_history`テーブルの作成に加えて、行レベルセキュリティ（`auth.uid()`による所有者限定の
SELECT/INSERT/DELETEポリシー）が有効になる（ADR-021）。

## 5. アカウントの作成（唯一の手段）

画面には新規登録の導線が無く、GoTrue側も`enable_signup = false`で自己登録を拒否する。
アカウントは次のコマンドでのみ作成する。

```bash
# パスワードを指定して作成
scripts/create_user.sh user@example.com 'password123'

# パスワードを省略するとランダム生成して表示する
scripts/create_user.sh user@example.com
```

`.env`の`SUPABASE_SERVICE_ROLE_KEY`を読ませる必要があるため、シェルに読み込んでから実行する。

```bash
set -a; source .env; set +a
scripts/create_user.sh user@example.com 'password123'
```

## 6. 動作確認

1. http://localhost:5173 を開き、ヘッダーの「ログイン」から手順5で作成したメールアドレス・
   パスワードでログインする（新規登録ボタンは存在しない）。
2. `EngineSelect`でGemini標準/Claude/OpenAIを選択して描画できる（未ログイン時は403
   `FREE_ACCESS_FORBIDDEN`になっていたことと比較する）。
3. 描画に成功すると生成履歴が自動保存される。保存内容はAPIで確認できる（画面上の履歴閲覧UIは
   未実装。ADR-019のトレードオフ）。

```bash
set -a; source .env; set +a
TOKEN=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/token?grant_type=password" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s http://localhost:8000/api/history -H "Authorization: Bearer $TOKEN"
```

RLSがDB側で効いていることは、WHERE句を使わないクエリでも自分の行しか返らないことで確認できる。

```bash
USER_ID=$(docker exec supabase_db_adapt-sheet psql -U postgres -d postgres -tAc \
  "SELECT id FROM auth.users WHERE email='user@example.com';")
docker exec -e PGPASSWORD=postgres supabase_db_adapt-sheet psql -h 127.0.0.1 -U authenticator -d postgres -c "
BEGIN;
SELECT set_config('request.jwt.claims', '{\"sub\":\"${USER_ID}\"}', true);
SET LOCAL ROLE authenticated;
SELECT count(*) FROM render_history;  -- 自分の行数だけが返る
COMMIT;"
```

## 7. Googleログイン

Google Cloudで発行したOAuthクライアントが必要。

1. Google Cloud Consoleで「OAuth 2.0 クライアント ID」（種類: ウェブアプリケーション）を作成する。
2. 承認済みのリダイレクトURIに `http://127.0.0.1:54321/auth/v1/callback` を登録する
   （本番のSupabaseプロジェクトへ向ける場合は、そのプロジェクトのURLのcallbackを登録する）。
3. 発行された値を`.env`へ設定し、Supabaseスタックを再起動する。

```bash
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<Google Cloudのクライアント ID>
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<Google Cloudのクライアント シークレット>
```

```bash
supabase stop && supabase start
```

`enable_signup = false`のため、**Googleアカウントのメールアドレスと同じアカウントを手順5で
先に作成しておかないとログインは成立しない**（未登録のGoogleアカウントで勝手にユーザーが増えない）。

## 8. 停止・後片付け

日常の`docker compose down`はSupabase CLIのスタックには影響しない（別管理のため）。
Supabase Local CLI側を止める場合は以下を実行する。

```bash
supabase stop
```

停止時のデータはDockerボリュームへバックアップされ、次の`supabase start`で復元される
（作成済みユーザーや生成履歴も残る）。完全に消したい場合は`supabase stop --no-backup`を使う。

---

## トラブルシュート

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| ログイン後もゲート対象エンジンが403のまま | `SUPABASE_JWT_JWKS_URL`未設定、または`host.docker.internal`にbackendコンテナから到達できない | `.env`の設定を確認し、`docker compose exec backend curl http://host.docker.internal:54321/auth/v1/.well-known/jwks.json`で疎通確認する |
| `GET /api/history`が500 | `render_history`テーブル未作成（マイグレーション未適用） | `docker compose exec backend alembic upgrade head`を実行する |
| 履歴が保存されない（描画は成功する） | `DATABASE_URL`未設定、またはRLSポリシーに合致しない | `.env`の`DATABASE_URL`がauthenticatorロールになっているか確認する。保存失敗時はbackendのログに警告が出る |
| ログインで`email_provider_disabled` | `[auth.email] enable_signup = false`にするとGoTrueのメール認証自体が無効化される | `supabase/config.toml`で`[auth.email] enable_signup = true`（新規登録の禁止は`[auth] enable_signup = false`が担う） |
| アカウント作成で`email_exists` | 同じメールアドレスのユーザーが既にある（`supabase stop`のバックアップから復元された場合を含む） | 既存アカウントでログインする、または`supabase stop --no-backup`で作り直す |
| ヘッダーにログインボタンが出ない | `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`未設定のままfrontendが起動している | `.env`設定後に`docker compose up -d frontend`でコンテナを作り直す |
| `supabase start`が失敗・固まる | 初回のDockerイメージpullに時間がかかっている、またはポート（54321-54324等）が競合している | しばらく待つ。競合時は`supabase/config.toml`でポート番号を変更する |

---

## セキュリティ上の注意

- `supabase start`が発行する`ANON_KEY`/`SERVICE_ROLE_KEY`/`JWT_SECRET`等はSupabase CLIの
  **公開されたデモ値**であり、秘匿情報ではない（Supabase公式ドキュメントにも同じ値が掲載されている）。
  ただし本番のSupabaseプロジェクトの値と混同してコミットしないこと（`.env`はGit管理外）。
- `SERVICE_ROLE_KEY`はRLSを迂回する管理者キー。`scripts/create_user.sh`のようなCLI操作のみで使い、
  フロントエンドのコードや`VITE_`接頭辞の環境変数には決して置かない（ブラウザへ露出する）。
- ローカルスタックは`0.0.0.0`にバインドされ、Studio等に認証がない（`supabase start`実行時の
  `Local dev security notice`参照）。開発機以外のネットワークに公開しない環境で使うこと。
