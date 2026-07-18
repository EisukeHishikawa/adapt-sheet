# 要件仕様書

`adapt-sheet` の要件定義・画面仕様・APIインターフェース・エラーコード定義をまとめる。背景・構想は [`../planning/brainstorm.md`](../planning/brainstorm.md) を参照。

---

## 1. プロダクト概要

エンジニアが保守しやすいHTML/CSS帳票を、AIの力で構築・管理するプラットフォーム。生成AI（Gemini/Claude/OpenAI、PDFを直接読み取るマルチモーダル入力）と、AIを介さない変換エンジン（Docling/pdf2htmlEX/PyMuPDF）を描画ボタンの隣で選べるモデル選択機能（ADR-015）、リアルタイムプレビューを統合したSPA。

### 対象ユーザー

- **未認証ユーザー**: アカウント登録なしで帳票の生成・プレビューを試せる（データ保存は不可）。
- **登録ユーザー**: Supabase Authでログインし、生成履歴・テンプレートをSupabaseに保存できる（フェーズ5で追加）。

---

## 2. 画面仕様

### 2.1 画面構成要素

| # | 要素 | 説明 |
|---|---|---|
| 1 | HTMLプレビュー表示エリア | 生成されたHTML/CSSをレスポンシブに描画するiframe等のコンポーネント |
| 2 | 3大入力エディタ | HTML入力 / JSON入力 / プロンプト入力（CSSはHTMLの`<style>`に埋め込む前提のため、独立の入力エディタ・APIフィールドとしては持たない。ADR-014） |
| 3 | ファイル操作 | PDFアップロードエリア（ドラッグ＆ドロップ対応） |
| 4 | コントロール | 縦幅・横幅サイズ入力、生成エンジン選択（EngineSelect、ADR-015）、描画ボタン |
| 5 | アーキテクチャインフォメーション | バックエンドAPI設計・システム構成・セキュリティ・CI/CD概要図（Mermaid埋め込み、インライン表示） |

### 2.2 主要機能

#### リアルタイム双方向プレビュー
- HTML/CSS/JSONの変更をリアルタイムに検知し、帳票プレビューに即座に反映する。
- 画面幅に応じたアスペクト比固定スケーリング（PC/iPhoneでそれぞれ最小/最大サイズを設定）。

#### インテリジェントテンプレート連動
- HTML内のテンプレート変数とJSONのキーを柔軟にマッピングする。
- タイトル等の固定情報はHTMLに直接記述し、明細データ等の業務データのみをJSONと連動させる（[CLAUDE.md](../CLAUDE.md) のコード規約に準拠）。

#### 定型サイズ自動入力
- A4たて/A4よこ/B5たて/B5よこ/A5たて/A5よこの6択を1つのSelect（トリガー+ドロップダウン、標準的なBase UIのSelectの見た目・挙動をそのまま使う）に統合する。各選択肢・トリガーの中身は、実寸(mm)の縦横比をそのまま反映した紙のイラスト+サイズ名(A4/B5/A5)。「たて」「よこ」の文字ラベルやmm表記は画面上に表示せず、方向はイラストの縦横比のみで表現する（アクセシブルネームはaria-labelで別途保持）。選択時、対応する縦横の寸法を自動入力する。初期値はA4たて（幅210mm・高さ297mm）。幅・高さの手動入力等どのプリセットとも一致しない寸法のときは、トリガーのイラストは常に1:1の固定正方形・サイズ名の表記が無い無印になる。

| サイズ | たて (mm) | よこ (mm) |
|---|---|---|
| A4 | 297 | 210 |
| A5 | 210 | 148 |
| B5 | 257 | 182 |

#### 履歴スライド機能
- 描画ボタン押下時、PDF・プロンプト・サイズ・生成エンジン選択をAPIへ送信する（CSS・JSON・HTMLは独立フィールドを持たない。ADR-014/016）。
- レスポンス（HTML/CSS/JSON）を反映し、再描画時は過去の描画内容を最大10件まで横にスライドしてスタックする（11件目以降は最も古い履歴を破棄）。

#### インテリジェントメッセージ表示
- バックエンドAPIのステータスコード（4xx, 5xx等）に準拠したエラー/成功メッセージをトースト等で表示する。

#### 描画中の進捗表示（ADR-014）
- Docling解析（PDFアップロード時）は数秒〜十数秒かかることがあるため、描画ボタン押下から完了までの間は「描画中...(N秒)」の形式で経過秒数を1秒ごとに表示し、処理が進行中であることを伝える。

---

## 3. APIインターフェース

### 3.1 `POST /api/render`

PDF・プロンプト・サイズ指定・生成エンジン選択を受け取り、選択したエンジンに応じてHTML/CSS/JSONを返却する中核エンドポイント（ADR-015）。

**リクエスト（multipart/form-data）**

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `pdf` | file | 任意 | ベースとなる既存PDF。`docling`/`pdf2htmlex`/`pymupdf`選択時は必須（無いと400） |
| `prompt` | string | 任意 | 生成方針の自然言語指示（生成AI選択時のみ使用） |
| `width_mm` | number | 任意 | 帳票の横幅（mm） |
| `height_mm` | number | 任意 | 帳票の縦幅（mm） |
| `engine` | string | 任意 | 生成エンジン。`gemini_free`（既定）/`gemini`/`claude`/`openai`/`docling`/`pdf2htmlex`/`pymupdf`のいずれか |

> `css`・`json`（業務データ）・`html`（既存HTML）はいずれも独立したリクエストフィールドを持たない（ADR-014/016）。生成AIへはPDFファイルをそのままマルチモーダル入力として渡し、PyMuPDF由来のHTMLやDocling由来のテキストを事前変換して渡すことはしない。
> `engine`が`gemini`/`claude`/`openai`（標準プラン）の場合、フェーズ5（Supabase Auth導入）まで自由アクセスのユーザーには`403 FREE_ACCESS_FORBIDDEN`を返す（4章参照）。

**レスポンス（200 OK）**

```json
{
  "html": "<!doctype html>...",
  "css": "body { ... }",
  "json": { "invoice_no": "{{invoice_no}}" }
}
```

> `engine`が変換エンジン（`docling`/`pdf2htmlex`/`pymupdf`）の場合、AIを介さず各エンジンの変換結果をそのまま`html`に、`css`は空文字列、`json`は空オブジェクトとして返す。

### 3.2 `POST /convert`（docling-service、内部API）

Docling変換専用のサービス（ADR-013/016）が公開する内部エンドポイント。ホストへはポートを公開せず、Docker Compose内部ネットワーク経由で`backend`からのみ呼び出される想定のため、CORS設定・認証は行わない。

**リクエスト（multipart/form-data）**

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `file` | file | 必須 | 変換対象のPDF |

**レスポンス（200 OK）**

```json
{
  "html": "<!doctype html>..."
}
```

**エラー**

| HTTPステータス | 説明 |
|---|---|
| `422 Unprocessable Entity` | PDFの構造が破損している等でDoclingによる変換に失敗（`detail`にエラーメッセージを含む素のFastAPIエラー形式。`backend`側の`RemoteDoclingHtmlExtractor`がこれを検知し、`PDF_CONVERSION_ERROR`として4.1の統一エラー形式に整形した上で`/api/render`のレスポンスに反映する） |

### 3.3 `POST /convert`（pdf2htmlex-service、内部API）

pdf2htmlEX変換専用のサービス（ADR-015）が公開する内部エンドポイント。docling-service（3.2）と同じ設計方針で、ホストへはポートを公開せず、Docker Compose内部ネットワーク経由で`backend`からのみ呼び出される。

**リクエスト（multipart/form-data）**

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `file` | file | 必須 | 変換対象のPDF |

**レスポンス（200 OK）**

```json
{
  "html": "<!doctype html>..."
}
```

**エラー**

| HTTPステータス | 説明 |
|---|---|
| `422 Unprocessable Entity` | PDFの構造が破損している等でpdf2htmlEXによる変換に失敗（`backend`側の`RemotePdf2HtmlExExtractor`がこれを検知し、`PDF_CONVERSION_ERROR`として4.1の統一エラー形式に整形した上で`/api/render`のレスポンスに反映する） |

### 3.4 型同期

FastAPIが自動生成する `openapi.json` からフロントエンド用のTypeScript型定義を生成し、フロント・バック間でキー名の手書き一致を排除する（[CLAUDE.md](../CLAUDE.md) 参照）。

- `backend/scripts/export_openapi.py`: サーバー起動なしで `app.openapi()` を `backend/openapi.json` へ書き出す
- `openapi-typescript`（`frontend`の`npm run generate-types`）: `backend/openapi.json` から `frontend/src/types/api.ts` を生成する

---

## 4. エラーコード定義

| HTTPステータス | `error.code` | ケース | 発生条件 |
|---|---|---|---|
| `400 Bad Request` | `VALIDATION_ERROR` | バリデーションエラー | 必須項目の欠如、サイズ指定の型不正、JSON構文エラーなど（変換エンジン選択時にPDF未添付の場合を含む） |
| `403 Forbidden` | `FREE_ACCESS_FORBIDDEN` | 標準プランの生成AI利用不可 | `engine`が`gemini`/`claude`/`openai`（標準プラン）で、フェーズ5のアカウント登録機能導入前（ADR-015） |
| `413 Payload Too Large` | `PAYLOAD_TOO_LARGE` | ファイルサイズ超過 | PDFアップロードサイズが上限を超過 |
| `422 Unprocessable Entity` | `PDF_CONVERSION_ERROR` | PDF解析エラー | PDFの構造が破損している、パスワード保護されている等でDocling/pdf2htmlEX/PyMuPDFによる変換に失敗 |
| `429 Too Many Requests` | `RATE_LIMITED` | レート制限超過 | 未認証エリアのIP単位、または認証エリアのユーザー単位のレート制限に抵触 |
| `502 Bad Gateway` | `AI_GENERATION_ERROR` | AI生成エラー | Gemini/Claude/OpenAI API呼び出し失敗、タイムアウト、不正なレスポンス形式 |
| `500 Internal Server Error` | `INTERNAL_ERROR` | 想定外のサーバーエラー | 上記以外の未分類の例外 |

各エラーは例外種別に応じたステータスコードを厳格に返す（[CLAUDE.md](../CLAUDE.md) のエラーハンドリング規約に準拠）。

### 4.1 エラーレスポンス形式（ステップ14・ADR-012）

すべてのエラー応答は、HTTPステータスに加えて次の構造化JSONボディを返す。フロントエンドはこの `message` をそのままユーザー向け文言として表示し、`request_id` を問い合わせ用に保持する（[CLAUDE.md](../CLAUDE.md) の型安全・エラーハンドリング規約に準拠）。

```json
{
  "error": {
    "code": "AI_GENERATION_ERROR",
    "message": "AIによる生成に失敗しました。しばらくしてから再度お試しください。",
    "request_id": "3f2b1c9a-4d5e-6f70-8a9b-0c1d2e3f4a5b"
  }
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `error.code` | string | 機械可読なエラー識別子（上表の `error.code` 列）。フロントの分岐処理に使う。 |
| `error.message` | string | ユーザーへ表示する安全な日本語文言。技術的詳細・スタックトレースは含めない。 |
| `error.request_id` | string | リクエスト単位の相関ID。同じ値が `X-Request-ID` レスポンスヘッダーおよびサーバーの構造化ログ（ステップ13・ADR-011）に出力され、障害調査時に画面表示とログを突き合わせられる。 |

- `message` はステータス／例外種別ごとに固定の安全文言へ丸める。バックエンドの生の例外メッセージ（英語や内部情報を含みうる）はサーバーログにのみ記録し、レスポンスには出さない。
- 成功・失敗を問わず全レスポンスに `X-Request-ID` ヘッダーを付与する（ステップ13で導入するログ基盤と相関）。

---

## 5. 今後の追記予定

- フェーズ2・3の実装が進み次第、画面のワイヤーフレームやAPIのリクエスト/レスポンス実例を追記する。
- フェーズ5の認証・DB統合時に、認証必須エンドポイント（履歴保存・取得等）の仕様をここに追加する。
