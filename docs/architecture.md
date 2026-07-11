# アーキテクチャ設計書

`adapt-sheet` のシステム構成・API設計・セキュリティ・CI/CDの概要をMermaid.jsで記述する。技術選定の理由は [`decisions.md`](./decisions.md) を参照。

---

## 1. システム構成図

```mermaid
flowchart LR
    subgraph Client["クライアント"]
        Browser["ブラウザ (SPA)"]
    end

    subgraph AWS["AWS"]
        CF["CloudFront"]
        S3["S3 (静的ホスティング)"]
        APIGW["API Gateway"]
        LambdaEntry["Lambda (入口エンドポイント)\nFastAPI + Lambda Web Adapter"]
        LambdaDocling["Lambda (Docling変換)\nDoclingモデル焼き込み済み"]
        WAF["AWS WAF"]
    end

    subgraph External["外部サービス"]
        Gemini["Gemini API (Google AI Studio)"]
        Auth0["Auth0"]
        Supabase["Supabase (PostgreSQL)"]
    end

    Browser -->|静的アセット取得| CF --> S3
    Browser -->|API呼び出し| WAF --> APIGW --> LambdaEntry
    LambdaEntry -->|PDF変換リクエスト (HTTP)| LambdaDocling
    LambdaEntry -->|生成AI呼び出し| Gemini
    LambdaEntry -->|認証トークン検証| Auth0
    LambdaEntry -->|データ保存/取得| Supabase
```

---

## 2. バックエンドAPI設計概要図

`POST /api/render` の処理フロー（詳細仕様は [`spec.md`](./spec.md) 参照）。

```mermaid
sequenceDiagram
    participant FE as フロントエンド
    participant API as FastAPI (/api/render)
    participant Docling as Docling
    participant Gemini as Gemini API

    FE->>API: PDF/HTML/CSS/JSON/プロンプト/サイズ送信
    alt PDFが存在する
        API->>Docling: PDF解析リクエスト
        Docling-->>API: ベースHTML/CSS
    end
    API->>API: 送信要素の有無に応じてプロンプトを動的構築
    API->>Gemini: 構造化生成リクエスト
    Gemini-->>API: HTML/CSS/JSON
    API-->>FE: 200 OK { html, css, json }
    Note over API,FE: バリデーション/AI生成/Docling解析エラーは<br/>例外種別に応じたHTTPステータスで返却
```

---

## 3. セキュリティ概要図

未認証エリアと認証エリアのアクセス制御の違い（詳細は [`spec.md`](./spec.md) の要件、決定理由は [`decisions.md`](./decisions.md) を参照）。

```mermaid
flowchart TD
    User["ユーザー"] --> WAF["AWS WAF\n(IP制限・レート制限)"]
    WAF --> Router{"認証トークンあり?"}

    Router -->|なし| Public["未認証エリア\n・ステートレスな変換/生成のみ\n・DBアクセス不可\n・IP単位レート制限"]
    Router -->|あり| Auth0Check["Auth0でJWT検証"]
    Auth0Check -->|有効| Private["認証エリア\n・Supabaseへの保存/閲覧許可\n・ユーザーID単位レート制限"]
    Auth0Check -->|無効| Reject["401/403エラー返却"]
```

---

## 4. CI/CD概要図

```mermaid
flowchart LR
    Dev["開発者"] -->|PR作成| GitHub["GitHub"]
    GitHub --> CI["GitHub Actions CI\n・Vitest (フロント)\n・pytest (バック)\n・ESLint / Ruff (静的解析)"]
    CI -->|全て成功| Review["レビュー & main へマージ\n(Branch Protection Ruleで直接push禁止)"]
    CI -->|失敗| Dev
    Review --> CD["GitHub Actions CD"]
    CD -->|Terraform apply| AWSInfra["AWS (S3 / Lambda / CloudFront)"]
```

---

## 5. 今後の追記予定

- フェーズ4（インフラ構築）着手時に、Terraformモジュール構成図を追加する。
- フェーズ5（認証・DB統合）着手時に、Supabaseのテーブル設計・ER図を追加する。
