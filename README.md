# adapt-sheet

エンジニアが保守しやすいHTML/CSS帳票を、AIの力で構築・管理するプラットフォーム。生成AI（Gemini/Claude/OpenAI）へPDFを直接読み取らせる生成と、AIを介さない変換エンジン（Docling/pdf2htmlEX/PyMuPDF）を描画ボタンの隣で選べるモデル選択機能、リアルタイムプレビューを統合したSPA（ADR-015）。

詳細な構想・要件は [`planning/brainstorm.md`](./planning/brainstorm.md)、開発の進め方は [`DEVELOPMENT.md`](./DEVELOPMENT.md) を参照。

## 技術スタック

- **フロントエンド**: React / TypeScript / Vite / Zustand / shadcn/ui / TailwindCSS
- **バックエンド**: Python / FastAPI / PyMuPDF / Docling / pdf2htmlEX / Gemini SDK / Anthropic SDK / OpenAI SDK / SQLAlchemy
- **型同期**: openapi-typescript（FastAPIの`openapi.json`からフロント用TypeScript型を生成。ADR-005参照）
- **テスト**: Vitest + React Testing Library + MSW / pytest / Playwright
- **インフラ**: Terraform / AWS (Lambda, CloudFront, S3, API Gateway, WAF) / GitHub Actions
- **認証・DB**: Supabase（Auth + PostgreSQL）

## クイックスタート

> 各セットアップ手順はフェーズ2・3の実装が進み次第、随時追記する。

開発環境はDocker Composeのみを対象とする。ローカル（非Docker）での直接実行はサポートしない（[docs/decisions.md](./docs/decisions.md) ADR-009参照）。

### 前提ツール

- **Docker Desktop**（または互換のOCIランタイム）: アプリの起動に必須
- **Homebrew**: `gh` 等のパッケージ管理に使用（[brew.sh](https://brew.sh)）
- **GitHub CLI (`gh`)**: リポジトリ作成・PR作成・Branch Protection設定に使用。`brew install gh` 後 `gh auth login` で認証

### 起動方法

```bash
docker compose up --build
```

- フロントエンド: http://localhost:5173
- バックエンド: http://localhost:8000

アプリは**常に同じポート**（frontend=`5173`、backend=`8000`。`docker-compose.yml`のマッピング、`frontend/vite.config.ts`の`port`/`strictPort`で固定）で起動する。別ポートへの自動退避は行わない（ポートずれで古いインスタンスを誤認する事故を防ぐため）。既に起動済みの場合は、同一ポートでのクリーンな単一インスタンスを保つため`docker compose up -d --force-recreate frontend backend`等で作り直す（複数インスタンスを別ポートで並行起動しない）。

backend/frontend/docling/pdf2htmlexはそれぞれ`./backend`・`./frontend`・`./docling-service`・`./pdf2htmlex-service`をコンテナへバインドマウントしているため、ホスト側でのコード編集はホットリロードされる。AI生成は既定で`USE_MOCK_AI=true`（`MockAIClient`）を使う構成にしている。実Gemini APIを使いたい場合は`docker-compose.yml`の`backend.environment`を`USE_MOCK_AI=false`・`GEMINI_API_KEY`に上書きする。

描画ボタンの隣（`EngineSelect`）で、7つの生成エンジンを選べる（[docs/decisions.md](./docs/decisions.md) ADR-015参照）。

| エンジン | 種別 | 説明 |
|---|---|---|
| Gemini API（無料） | 生成AI | PDFを直接読み取り、無料枠モデルで整形。既定エンジン |
| Gemini API | 生成AI（標準プラン） | フェーズ5まで自由アクセスのユーザーは利用不可（403） |
| Claude API | 生成AI（標準プラン） | 同上 |
| OpenAI API | 生成AI（標準プラン） | 同上 |
| Docling | 変換エンジン（AIなし） | PDFのテキスト・論理構造をHTML化し、そのまま描画結果にする |
| pdf2htmlEX | 変換エンジン（AIなし） | PDFの見た目をフォント・画像埋め込みでそのままHTML化する |
| PyMuPDF | 変換エンジン（AIなし） | PDFのレイアウト（座標・罫線・背景）を絶対座標のdivで再現する |

生成AI（Gemini/Claude/OpenAI）はPDFをファイルとしてそのままマルチモーダル入力に添付する。PyMuPDF由来のHTMLやDocling由来のテキストを事前変換して渡すことはしない（ADR-015。ADR-013/015で採用していた「レイアウトHTML＋Docling Markdownの両方をGeminiへ渡す」方式は本ADRで置き換えられた）。Docling/pdf2htmlEX/PyMuPDFを選んだ場合はAIを一切呼ばず、各エンジンの変換結果をそのまま描画結果として返す。

実際にGeminiへ渡したプロンプト全文と、Geminiが返した出力全文はバックエンドのログで確認できる（`docker-compose.yml`で`LOG_AI_PAYLOAD=true`を設定済み）。ログは1行1レコードのJSONのため、`jq`で該当フィールドだけを取り出すと読みやすい。

```bash
docker compose logs backend | grep '"logger": "app.ai"' | jq -r '.ai_prompt // .ai_response'
```

プロンプトには帳票の業務データが含まれるため、コード側の既定は無効（未設定＝出力しない）であり、有効化しているのはこの開発用Compose構成のみ。実際に出力されるのは実Gemini経路（`USE_MOCK_AI=false`）のときで、既定のモック経路では出力されない。

#### プロセスの手動再起動

`uvicorn`（`--reload`）・Vite開発サーバーはコンテナ起動時に自動実行されるため、通常は上記の`docker compose up --build`のみで良い。自動リロードが固まった場合など、プロセスを手動で再起動したい場合はコンテナごと再起動する（`docker compose exec`で同じコマンドを追加実行すると、起動中のプロセスが既にポートを掴んでいるため`Address already in use`になり動作しない）。

```bash
docker compose restart backend
docker compose restart frontend
```

### ログイン機能をローカルで検証する（Supabase Local CLI、ADR-020）

`docker compose up --build`だけではAuth関連の環境変数（`VITE_SUPABASE_URL`等）が未設定のため、ヘッダーのログインUI自体が表示されない（Supabaseプロジェクト未作成のローカル開発を壊さないための既定挙動）。実際に新規登録・ログインしてゲート対象エンジン（Gemini標準/Claude/OpenAI）や生成履歴（`GET /api/history`）を検証したい場合は、[`docs/supabase-local-cli-setup.md`](./docs/supabase-local-cli-setup.md)の手順でSupabase Local CLIのローカルスタックを起動し、`.env`にキーを設定する。

### テスト・静的解析

起動中のコンテナに対して実行する。

```bash
docker compose exec backend pytest                    # 全テスト実行
docker compose exec backend pytest path/to/test.py -v  # 単体テスト
docker compose exec backend ruff check .                # 静的解析
docker compose exec docling pytest                       # doclingサービス（PDF→HTML変換専用）の全テスト実行
docker compose exec docling ruff check .                  # doclingサービスの静的解析
docker compose exec docling python scripts/verify_docling.py # Docling単体動作検証（環境依存の早期確認）
docker compose exec docling curl -sf -F "file=@tests/fixtures/sample.pdf" http://localhost:8100/convert # /convertを直接叩いて動作確認（ホスト非公開のため、docling自身にexecして呼び出す）
docker compose exec pdf2htmlex pytest                     # pdf2htmlex-service（PDF→HTML変換専用）の全テスト実行
docker compose exec pdf2htmlex ruff check .                # pdf2htmlex-serviceの静的解析
docker compose exec pdf2htmlex curl -sf -F "file=@tests/fixtures/sample.pdf" http://localhost:8200/convert # /convertを直接叩いて動作確認
docker compose exec backend pytest tests/test_pdf_layout.py -v # レイアウトHTML生成（PyMuPDF、backend内モジュール・ADR-014）のテスト
docker compose exec backend alembic upgrade head          # 生成履歴用DBマイグレーションの適用（backend/migrations、ADR-019）
docker compose exec frontend npm run test               # Vitest（msw使用、実APIには接続しない）
docker compose exec frontend npm run lint                # ESLint
```

E2E（Playwright）は、frontendの軽量な`node:20-alpine`イメージがブラウザバイナリに非対応（Alpine/musl libc）のため、Microsoft公式のPlaywrightイメージを使う独立サービス`e2e`から実行する（[docs/decisions.md](./docs/decisions.md) ADR-009参照）。常時起動しないよう`profiles`でopt-in化しているため、`--profile e2e`を付けて実行する。

```bash
docker compose --profile e2e run --rm e2e
```

### PDF変換結果を直接ファイルへ出力する（アプリを介さない動作確認）

`backend`のAPI（`/api/render`）を経由せず、各変換経路の出力を手元のファイルとして確認したい場合の手順。

```bash
# レイアウトHTML（PyMuPDF、backend内モジュール）: PDFをコンテナへコピーし、変換して取り出す
docker compose cp "/path/to/input.pdf" backend:/tmp/input.pdf
docker compose exec -T backend python -c "from app.services.pdf_layout import PyMuPDFLayoutConverter; open('/tmp/output.html','w').write(PyMuPDFLayoutConverter().convert_to_html('input.pdf', open('/tmp/input.pdf','rb').read()))"
docker compose cp backend:/tmp/output.html "/path/to/output.html"
open "/path/to/output.html"   # ブラウザでレイアウトの再現度を目視確認できる

# Docling（HTML）: 同様にコピーして/convertを叩き、htmlフィールドを取り出す
docker compose cp "/path/to/input.pdf" docling:/tmp/input.pdf
docker compose exec -T docling curl -sf -F "file=@/tmp/input.pdf" http://localhost:8100/convert \
  | python3 -c "import json,sys; sys.stdout.write(json.load(sys.stdin)['html'])" > "/path/to/docling-output.html"

# pdf2htmlEX（HTML）: 同様にコピーして/convertを叩き、htmlフィールドを取り出す
docker compose cp "/path/to/input.pdf" pdf2htmlex:/tmp/input.pdf
docker compose exec -T pdf2htmlex curl -sf -F "file=@/tmp/input.pdf" http://localhost:8200/convert \
  | python3 -c "import json,sys; sys.stdout.write(json.load(sys.stdin)['html'])" > "/path/to/pdf2htmlex-output.html"
```

### 型同期

バックエンドの`openapi.json`からフロント用TypeScript型（`frontend/src/types/api.ts`）を再生成する場合は以下を実行する（スキーマ変更時に都度実行する運用。ADR-005）。

```bash
docker compose exec backend python scripts/export_openapi.py
docker compose exec frontend npm run generate-types
```

## ドキュメント一覧

| ドキュメント | 内容 |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | ClaudeCode向けの開発ルール・コマンド定義 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 開発ロードマップ（フェーズ・ステップ） |
| [planning/brainstorm.md](./planning/brainstorm.md) | 初期構想・要件・技術選定メモ |
| [docs/spec.md](./docs/spec.md) | 要件定義、画面仕様、APIインターフェース |
| [docs/architecture.md](./docs/architecture.md) | アーキテクチャ図 |
| [docs/decisions.md](./docs/decisions.md) | アーキテクチャ決定記録 (ADR) |
| [docs/deployment.md](./docs/deployment.md) | デプロイ手順・運用の手引き |
| [docs/supabase-mcp-setup.md](./docs/supabase-mcp-setup.md) | Supabase MCPのセットアップ・ログイン手順 |
| [docs/supabase-local-cli-setup.md](./docs/supabase-local-cli-setup.md) | Supabase Local CLIによるログイン機能のローカル検証手順 |
