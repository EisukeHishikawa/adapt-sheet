# コーディングルール

AdaptSheet AI のコードを書くときの具体的な規約。設計思想・協働ルールは [`CLAUDE.md`](../CLAUDE.md)、技術選定の理由は [`docs/decisions.md`](./decisions.md) を参照。

判断に迷ったら、本ドキュメントより**周辺の既存コード**を優先する。既存コードと本ドキュメントが食い違う場合は、どちらかを直してから作業する。

## 1. 共通

### 言語

- コメント・docstring・テスト名・ユーザー向け文言は**日本語**。
- 識別子（変数・関数・クラス・ファイル名）は**英語**。

### 命名

- モジュール内部だけで使う関数・定数は先頭に `_` を付ける（Python）。TypeScript は `export` しないことで表す。
- 定数は `UPPER_SNAKE_CASE`。単位を名前に含める（`RENDER_JOB_POLL_INTERVAL_MS`、`width_mm`、`MAX_HISTORY_ITEMS`）。
- 「何をするか」ではなく「何であるか」で名付け、コメントで補わないと意味が通らない名前は付け直す。

### コメント

CLAUDE.md のコメント3原則（コードに語らせる／How を書かない／経緯・参照を書かない）に従う。加えて実運用上のルール:

- 書くのは「なぜその選択をしているか」と、コードから読み取れない**外部制約**（API Gateway の29秒タイムアウト、Starlette のハンドラ探索順、Base UI の仕様など）。
- 2行以内。それ以上必要なら関数分割かドキュメント側へ移す。
- 定数・型のフィールドには、値の意味が自明でない場合に限り1行の説明を添える（`engines.ts` の `EngineDefinition` が基準）。
- 「ステップ18で」「以前は」「ADR-0XX 参照」等は書かない。

### ファイル分割

- 1ファイル1責務。500行を超えたら分割を検討する。
- フロント・バックで対になる定義（エンジン一覧、エラー文言）は、**片側を一次ソース**とし、他方のコメントで参照元を明示する（例: `frontend/src/lib/engines.ts` は `backend/app/services/engines.py` の `ENGINE_SPECS` と同じ値）。

### リンター・フォーマッタ

- リンターもフォーマッタも**ホストへ入れず、Docker内のもの**をエディタからLSPとして使う（`docker compose --profile lsp` の `backend-lsp` / `frontend-lsp`）。エディタの診断・整形結果を `docker compose exec` で実行するCIと一致させるため。
- 設定は [`.zed/settings.json`](../.zed/settings.json)（LSP起動は [`scripts/zed-lsp.sh`](../scripts/zed-lsp.sh)）。クローン直後は `./scripts/setup-zed.sh` で絶対パスを自環境へ合わせる。
- 規則の一次ソースは各サービスの `ruff.toml` と `frontend/eslint.config.js`、ツールの版は `requirements.txt` / `package.json`。エディタ側の設定でルールを上書きしない。
- 整形の扱いは言語で異なる。Python は `ruff format` が保存時に自動適用されCIでも検査するが、TypeScript は整形ツールを使わず書き手が既存スタイルに合わせる。詳細は各言語の節を参照。

## 2. Python（backend / docling-service / pdf2htmlex-service）

### 静的解析・フォーマット

- `ruff check .`（リント）と `ruff format --check .`（整形漏れの検出）の両方を通すこと。どちらもCIの必須チェックで、ruff の版は各サービスの `requirements.txt` で固定する。
- リント規則は ruff 既定（E4/E7/E9/F）。ルールの追加・除外は行っていない。
- フォーマッタは `ruff format`。**保存時に自動適用**される（`format_on_save: "on"`）ので、手で桁を揃えず整形結果に従う。
- 行長は各サービスの `ruff.toml` で **120文字**（既定の88文字では日本語コメントと型注釈付きシグネチャが頻繁に折り返されるため）。`ruff.toml` を backend / docling-service / pdf2htmlex-service にそれぞれ置いているのは、各サービスが独立したコンテナで自身のディレクトリを `/app` として ruff を動かすため。
- 整形だけの差分は他の変更と混ぜない。設定を変えて全体を再整形する場合は単独のPRにする。

### 型

- 公開関数には引数・戻り値の型注釈を必ず付ける。
- ファイル冒頭に `from __future__ import annotations` を置く（`app/main.py` を除く全モジュールの慣習）。Python 3.9 で `dict[int, str]` 等の記法を使うため。
- API の入出力は Pydantic モデルで定義し、エンドポイントに `response_model` を必ず指定する（省略すると `openapi.json` のスキーマが `object` 止まりになり、フロントの型生成が壊れる）。

### モジュール構成

- `app/main.py`: エンドポイント定義とリクエスト検証のみ。ビジネスロジックは `app/services/` に置く。
- `app/services/<機能>.py`: 1機能1モジュール。外部サービス呼び出しは専用クライアント（`docling_client.py` 等）に閉じる。
- 差し替えたい依存（AIクライアント、DBセッション、抽出クライアント）は `get_xxx()` のプロバイダ関数として公開し、FastAPI の `Depends` 経由で注入する。テストは `app.dependency_overrides` で差し替える。テストのためだけにグローバル変数を書き換えない。

### docstring

- モジュール冒頭・公開関数には1行の docstring を置く。役割が名前から自明な小関数には不要。
- docstring にも「なぜ」を書く。処理手順の逐語説明は書かない。

### エラーハンドリング

- ドメイン例外（`PDFConversionError` / `AIGenerationError` 等）を定義して `raise` するだけにし、HTTP ステータスへの変換は `app/errors.py` に一元化する。`main.py` の中で `HTTPException` へ詰め替えない。
- ステータスと例外の対応は `_DOMAIN_ERRORS` / `_ERROR_CATALOG` が唯一の対応表。新しいエラーを足すときはこの表に追加する。
- 例外の生メッセージをレスポンスへ出さない。ログにだけ残し、ユーザーには `_ERROR_CATALOG` の日本語文言を返す。
- `except:` や握りつぶしを書かない。捕捉したら必ずログか再送出のどちらかを行う。

### ログ

- `logging.getLogger("app.<領域>")` を使う（`app.errors` / `app.warmup` / `app.render_jobs` 等）。`print` は使わない。
- 構造化フィールドは `extra={...}` に渡し、`request_id` を含める。
- APIキー・リクエストボディ全文・PDFバイト列はログに出さない。

## 3. TypeScript / React（frontend）

### 静的解析・フォーマット

- `npm run lint`（ESLint）と `npm run build`（`tsc -b`）を通すこと。どちらもCIの必須チェック。
- **整形ツールは使っていない**。Prettier は導入せず、`.zed/settings.json` で `prettier.allowed: false` を明示して Zed 同梱のものも走らないようにしている。
- 保存時に走るのは ESLint の自動修正（`source.fixAll.eslint`）だが、これは未使用 import の削除等のリント修正であって**整形ではない**。ESLint 本体は v9 以降、整形系ルール（`indent` / `quotes` / `semi` 等）を非推奨として本体から外しており、`eslint.config.js` が読み込む4つのプリセットにも整形ルールは含まれない。
- したがって書式は**書き手が既存コードに合わせる**: **2スペース・シングルクォート・セミコロンなし・行長120文字程度**。Python 側（`ruff format`）と違い、CIも整形崩れを検出しない。

### 型

- API のリクエスト/レスポンス型は `src/types/api.ts`（`openapi.json` からの自動生成）を必ず経由する。キー名を手書きしない。
- `any` を使わない。外部由来の値は `unknown` で受け、絞り込んでから使う（`parseErrorBody` が基準）。
- 型は `type` で定義し、`import type` で読み込む。

### コンポーネント

- 関数コンポーネント＋**名前付きエクスポート**（`export function EngineSelect()`）。`export default` は `App.tsx` のみ。
- 1ファイル1コンポーネント。`src/components/` 直下に置き、shadcn/ui の生成物は `src/components/ui/` へ（このディレクトリは手で書き換えない）。
- スタイルは Tailwind のユーティリティクラス。独自CSSファイルを増やさない。
- 操作対象には `aria-label` を付ける。テストは `getByRole` で引くため、ラベルは表示文言と揃える。
- インポートは `@/` エイリアス（`@/lib/api`、`@/store/sheetStore`）。相対パスは同一ディレクトリ内のみ。

### 状態管理

- グローバル状態は zustand（`src/store/`）。コンポーネントからは**フィールド単位のセレクタ**で購読する（`useSheetStore((state) => state.engine)`）。ストア全体を購読しない。
- API 呼び出しは `src/lib/api.ts` の関数に閉じる。コンポーネントから直接 `fetch` しない。
- 副作用を伴う一連の処理（描画ジョブの起動〜ポーリング）はストアのアクションに置き、コンポーネントは呼ぶだけにする。

### エラー表示

- バックエンドの構造化エラー（`error.message`）をそのままユーザー向け文言として表示する。フロント側の固定文言は、バックエンドへ到達できなかった場合のフォールバックに限る。
- `RenderApiError` の `status` / `code` で分岐する。エラーメッセージ文字列をパースして判定しない。

## 4. テスト

- **実装前にテストを書く**（Red → Green）。テストのない実装を追加しない。
- 生成AI（Gemini/Claude/OpenAI）を実際に叩かない。pytest の既定は常に `MockAIClient`（`USE_MOCK_AI` 未設定時）で、`engine` 等のパラメータ値によってこの既定を変えない。
- フロントのテストは msw でモックし、実APIへ接続しない。

### backend（pytest）

- `backend/tests/test_<対象モジュール>.py`。テスト関数名は英語 `test_<条件>_<期待結果>`。
- 依存の差し替えは `app.dependency_overrides`。テスト後は必ず解除する。
- テスト内のヘルパーは `_` 始まりで定義し、既存の同種テスト（`test_history.py` の SQLite セッション方式など）と同じ手順を踏襲する。

### frontend（Vitest + React Testing Library）

- 実装ファイルと同じディレクトリに `<Name>.test.tsx` / `<name>.test.ts` を置く。
- `describe` / `it` の説明は日本語で、**仕様として読める文**にする（例: `it('開くと8つの選択肢が、生成AI5種→変換エンジン3種の順で並ぶ')`）。
- 要素の取得は `getByRole` / `getByLabelText` を優先する。クラス名や DOM 構造に依存した取得をしない。
- タイマーを含む処理は `vi.useFakeTimers` で待たずに進める。

## 5. フロント・バック間の型同期

APIのスキーマを変えたら、同じPRの中で次を実行して生成物をコミットする。

```bash
docker compose exec backend python scripts/export_openapi.py   # backend/openapi.json を更新
docker compose exec frontend npm run generate-types             # src/types/api.ts を更新
```

`src/types/api.ts` と `backend/openapi.json` は生成物のため手で編集しない。

## 6. セキュリティ

- APIキー・トークン・パスワードをコードに直書きしない。設定は環境変数、本番は Parameter Store（`app/secrets_loader.py`）から取得する。
- 秘密情報を含むファイル（`.env` 等）の内容を出力しない。
- ユーザー入力を組み立てて生成AIへ渡す箇所では、長さ上限をフロント・バックの両方で設ける（`prompt` は `max_length=100`）。

## 7. 依存の追加

- Python は `requirements.txt`、Node は `package.json` に**バージョンを固定**して追加する。
- ホストで直接動かすツール（Terraform / Node / Python / AWS CLI / Supabase CLI / GitHub CLI）のバージョンは `mise.toml` で固定する。`node` / `python` は各 `Dockerfile` のベースイメージとパッチバージョンまで揃える。
- ホストに ruff / ESLint を追加導入しない（エディタの診断も Docker 内のものを使う）。
