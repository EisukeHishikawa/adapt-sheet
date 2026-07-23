# アーキテクチャ設計書

`adapt-sheet` のシステム構成・API設計・セキュリティ・CI/CDの概要をMermaid.jsで記述する。技術選定の理由は [`decisions.md`](./decisions.md) を参照。

---

## 1. システム構成図

本番環境の構成要素と接続関係のみを示す（処理の分岐やゲート判定は「4. バックエンドAPI設計概要図」を参照）。

```mermaid
flowchart LR
    subgraph Client["クライアント"]
        Browser["ブラウザ (SPA)"]
    end

    subgraph AWS["AWS"]
        CF["CloudFront"]
        S3["S3 (静的ホスティング)"]
        APIGW["API Gateway"]
        LambdaEntry["Lambda (入口API)"]
        LambdaDocling["Lambda (Docling)"]
        LambdaPdf2HtmlEx["Lambda (pdf2htmlEX)"]
    end

    subgraph External["外部サービス"]
        Gemini["Gemini API"]
        Claude["Claude API"]
        OpenAI["OpenAI API"]
        Supabase["Supabase (Auth + PostgreSQL)"]
    end

    Browser -->|静的アセット| CF --> S3
    Browser -->|"/api/*"| CF --> APIGW --> LambdaEntry
    LambdaEntry -->|SigV4| LambdaDocling
    LambdaEntry -->|SigV4| LambdaPdf2HtmlEx
    LambdaEntry --> Gemini
    LambdaEntry --> Claude
    LambdaEntry --> OpenAI
    LambdaEntry --> Supabase
```

- フロントとAPIは同一オリジン（CloudFront配下の`/api/*`）で提供する（ADR-029）。
- 入口Lambdaは`FastAPI + Lambda Web Adapter`で動き、PyMuPDFによるレイアウト変換を内包する（ADR-014）。
- Docling/pdf2htmlEXの各Lambdaは内部専用で、API Gatewayを介さずAWS_IAM認証必須のFunction URLとして公開する（ADR-026）。
- 生成AIへはPDFをマルチモーダル入力として直接添付する（ADR-015）。

---

## 2. 開発環境の構成図

`docker compose up --build` で起動する開発環境（`docker-compose.yml`、ADR-010）。ホストへ公開するのは frontend(5173) と backend(8000) のみで、変換系サービスはCompose内部ネットワークからのみ到達できる。

```mermaid
flowchart LR
    Dev["開発者 (ブラウザ / エディタ)"]

    subgraph Compose["Docker Compose (開発環境)"]
        FE["frontend<br/>Vite + React<br/>:5173"]
        BE["backend<br/>FastAPI<br/>:8000"]
        DL["docling<br/>:8100 (内部のみ)"]
        PH["pdf2htmlex<br/>:8200 (内部のみ)"]
        E2E["e2e (profile: e2e)<br/>Playwright"]
        LSP["backend-lsp / frontend-lsp<br/>(profile: lsp)<br/>Ruff / ESLint"]
    end

    subgraph Host["ホスト側ツール"]
        SB["Supabase Local CLI<br/>Auth + PostgreSQL"]
        Mise["mise (Terraform / Node / Python / CLI群)"]
    end

    Dev --> FE
    Dev --> BE
    Dev --> LSP
    FE --> BE
    BE --> DL
    BE --> PH
    BE --> SB
    FE --> SB
    E2E --> FE
    Dev --> Mise
```

- 生成AIはpytest・ローカル開発とも既定でモック（`USE_MOCK_AI=true`）を経由し、実APIを叩かない。
- `e2e` と `*-lsp` は `profiles` によるopt-inで、常時起動しない（ADR-010/024）。
- Docling用のMLモデルは名前付きボリュームへ永続化し、コンテナ再作成時の再ダウンロードを避ける。
- ホスト側ツールのバージョンは `mise.toml` で固定する（ADR-023）。

---

## 3. 認証認可の仕組みの構成図

認証はSupabase Auth（Google OAuth、認可コード＋PKCE）に委譲し、バックエンドはJWTを検証するだけでセッションを持たない（ADR-020/021）。

```mermaid
flowchart LR
    subgraph Front["フロントエンド (SPA)"]
        AuthStore["authStore<br/>supabase-js"]
        Session["セッション保管<br/>sessionStorage"]
    end

    subgraph SupabaseSvc["Supabase"]
        SBAuth["Supabase Auth<br/>JWT発行 / JWKS公開"]
        SBDB["PostgreSQL<br/>render_history (RLS有効)"]
    end

    subgraph Backend["backend (FastAPI)"]
        Verify["JWT検証<br/>services/auth.py"]
        Gate["engineゲート判定<br/>GATED_ENGINES"]
        DBConn["DB接続<br/>authenticatorロール"]
    end

    Google["Google OAuth"]

    AuthStore -->|signInWithOAuth| SBAuth
    SBAuth --> Google
    SBAuth -->|access_token| Session
    Session -->|"Authorization: Bearer"| Verify
    SBAuth -->|"JWKS / 共有シークレット"| Verify
    Verify --> Gate
    Verify -->|sub| DBConn
    DBConn -->|"auth.uid() で行を制限"| SBDB
```

- トークンは `sessionStorage` に保持し、タブを閉じた時点で破棄する（ADR-021）。
- 検証鍵は署名方式で切り替わる（`HS256`は共有シークレット、`ES256`/`RS256`はJWKS。ADR-020）。設定が無い場合は常に未ログイン扱い（fail-closed）。
- 認可は2段構え。ゲート対象engine（`gemini`/`claude`/`openai`）は未ログインなら403 `FREE_ACCESS_FORBIDDEN`、履歴データはPostgreSQLのRLSで`auth.uid()`一致行のみに制限する（ADR-019/021）。
- アカウント作成は `scripts/create_user.sh` のみで、画面からの新規登録は提供しない（ADR-021）。

---

## 4. バックエンドAPI設計概要図

`POST /api/render` の処理フロー（詳細仕様は [`spec.md`](./spec.md) 参照）。

エンジン選択（`engine`、ADR-015）により処理が3方向に分岐する。生成AI（Gemini/Claude/OpenAI）はPDFをマルチモーダル入力として直接受け取り、PyMuPDF/Doclingによる事前変換は行わない（HTML/JSON/Doclingテキストは生成AIへ送らない）。Docling/pdf2htmlEX/PyMuPDFはAIを介さず、変換結果をそのまま描画結果として返す。

```mermaid
sequenceDiagram
    participant FE as フロントエンド
    participant API as FastAPI (/api/render)
    participant Layout as PyMuPDF (backend内)
    participant Docling as Docling
    participant Pdf2HtmlEx as pdf2htmlEX
    participant AI as Gemini/Claude/OpenAI

    FE->>API: PDF/プロンプト/サイズ/engine送信
    alt engineが標準プラン（Gemini標準/Claude/OpenAI）
        API-->>FE: 403（フェーズ5まで自由アクセス不可、ADR-015）
    else engineが変換エンジン（Docling/pdf2htmlEX/PyMuPDF）
        Note over API,Pdf2HtmlEx: いずれか1つをengineに応じて呼び出す。AIは介さない
        API->>Layout: PDF（pymupdf選択時）
        API->>Docling: PDF（docling選択時）
        API->>Pdf2HtmlEx: PDF（pdf2htmlex選択時）
        Layout-->>API: HTML
        Docling-->>API: HTML
        Pdf2HtmlEx-->>API: HTML
        API-->>FE: 200 OK { html, css: "", json: {} }
    else engineがGemini（無料）
        API->>API: プロンプトを動的構築（PDFがあれば見た目の正として扱う指示）
        API->>AI: PDF（マルチモーダル添付、あれば）+ 指示
        AI-->>API: HTML/CSS/JSON
        API-->>FE: 200 OK { html, css, json }
    end
    Note over API,FE: バリデーション/AI生成/PDF解析エラーは<br/>例外種別に応じたHTTPステータスで返却
```

---

## 5. セキュリティ概要図

未認証エリアと認証エリアのアクセス制御の違い（詳細は [`spec.md`](./spec.md) の要件、決定理由は [`decisions.md`](./decisions.md) を参照）。API Gatewayのステージ単位スロットリングはIPアドレスやユーザーIDを区別せず全体合算でカウントする点に注意（ADR-027）。

```mermaid
flowchart TD
    User["ユーザー"] --> APIGW["API Gateway<br/>(ステージ単位スロットリング)"]
    APIGW --> Router{"認証トークンあり?"}

    Router -->|なし| Public["未認証エリア<br/>・ステートレスな変換/生成のみ<br/>・DBアクセス不可<br/>・ステージ全体合算のスロットリング"]
    Router -->|あり| SupabaseAuthCheck["Supabase AuthでJWT検証"]
    SupabaseAuthCheck -->|有効| Private["認証エリア<br/>・Supabaseへの保存/閲覧許可<br/>・ステージ全体合算のスロットリング"]
    SupabaseAuthCheck -->|無効| Reject["401/403エラー返却"]
```

---

## 6. CI/CD概要図

```mermaid
flowchart LR
    Dev["開発者"] -->|PR作成| GitHub["GitHub"]
    GitHub --> CI["GitHub Actions CI<br/>・Vitest (フロント)<br/>・pytest (バック)<br/>・ESLint / Ruff (静的解析)"]
    CI -->|全て成功| Review["レビュー & main へマージ<br/>(Branch Protection Ruleで直接push禁止)"]
    CI -->|失敗| Dev
    Review --> CD["GitHub Actions CD"]
    CD -->|"Terraform apply"| AWSInfra["AWS (S3 / Lambda / CloudFront)"]
```

---

## 7. データベース（PostgreSQL、ステップ28・ADR-019）

`render_history`テーブル（`backend/app/models.py`）のみ。登録ユーザーが`POST /api/render`を成功させるたびに1行追加される。`user_id`はSupabase Auth（`auth.users.id`）のUUIDをそのまま文字列で持つが、本DBは`auth`スキーマを所有しないため外部キー制約は張らない。

| カラム | 型 | 説明 |
|---|---|---|
| `id` | UUID (PK) | 履歴の一意識別子 |
| `user_id` | string | Supabase JWTの`sub`（`auth.users.id`） |
| `engine` | string | 描画に使ったエンジン（`RenderEngine`のいずれか） |
| `html` / `css` / `json_data` | text / text / json | `POST /api/render`のレスポンスと同一内容 |
| `width_mm` / `height_mm` | float, nullable | 帳票サイズ |
| `created_at` | timestamptz | 保存日時 |

マイグレーションは`backend/migrations/`（Alembic）で管理する。

## 8. 今後の追記予定

- フェーズ4（インフラ構築）着手時に、Terraformモジュール構成図を追加する。
- 保存済み履歴の閲覧UI・名前付きテンプレート機能を追加する際、テーブル設計を拡張する（ADR-019のトレードオフ参照）。
