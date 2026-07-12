# adapt-sheet

エンジニアが保守しやすいHTML/CSS帳票を、AIの力で構築・管理するプラットフォーム。既存PDFの解析（pdf2htmlEXによるレイアウト再現＋Doclingによるテキスト抽出）とGemini APIによる生成、リアルタイムプレビューを統合したSPA。

詳細な構想・要件は [`planning/brainstorm.md`](./planning/brainstorm.md)、開発の進め方は [`DEVELOPMENT.md`](./DEVELOPMENT.md) を参照。

## 技術スタック

- **フロントエンド**: React / TypeScript / Vite / Zustand / shadcn/ui / TailwindCSS
- **バックエンド**: Python / FastAPI / pdf2htmlEX / Docling / Gemini SDK / SQLAlchemy
- **型同期**: openapi-typescript（FastAPIの`openapi.json`からフロント用TypeScript型を生成。ADR-006参照）
- **テスト**: Vitest + React Testing Library + MSW / pytest / Playwright
- **インフラ**: Terraform / AWS (Lambda, CloudFront, S3, API Gateway, WAF) / GitHub Actions
- **認証・DB**: Auth0 / Supabase (PostgreSQL)

## クイックスタート

> 各セットアップ手順はフェーズ2・3の実装が進み次第、随時追記する。

開発環境はDocker Composeのみを対象とする。ローカル（非Docker）での直接実行はサポートしない（[docs/decisions.md](./docs/decisions.md) ADR-014参照）。

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

backend/frontend/docling/pdf2htmlexはそれぞれ`./backend`・`./frontend`・`./docling-service`・`./pdf2htmlex-service`をコンテナへバインドマウントしているため、ホスト側でのコード編集はホットリロードされる。AI生成は既定で`USE_MOCK_AI=true`（`MockAIClient`）を使う構成にしている。実Gemini APIを使いたい場合は`docker-compose.yml`の`backend.environment`を`USE_MOCK_AI=false`・`AI_PROVIDER=gemini`・`GEMINI_API_KEY`に上書きする。

PDF解析はbackendとは別の2コンテナ（どちらもホスト非公開）へ分離し、backendから内部HTTPで**並列に**呼び出す（[docs/decisions.md](./docs/decisions.md) ADR-018/023参照）。

| コンテナ | 役割 | 出力 |
|---|---|---|
| `pdf2htmlex` | レイアウト（座標・罫線・フォント）の再現。**見た目の正** | HTML（レイアウトCSSのみ埋め込み） |
| `docling` | 本文テキストと論理構造の抽出。**テキストの正** | Markdown |

Geminiにはこの2つを両方渡し、「レイアウトはHTML、文字列はMarkdownを正とする」役割分担で整形させる。

> pdf2htmlEXの出力からは、埋め込みフォント・背景画像（base64）とビューア用JSを除去している。LLMには読めない一方でペイロードの大半を占め、Gemini APIが503を返す原因になるため（[docs/decisions.md](./docs/decisions.md) ADR-023参照）。ブラウザで見た目を確認したい場合は、すべて埋め込む`pdf2htmlex-service/scripts/convert.sh`を使う。

> 当初はOllama（`llama3.2:3b`）コンテナも構成していたが、Docling抽出後の長いプロンプトに対してJSON整形が安定せず`/api/render`が頻繁に502で失敗したため廃止した（[docs/decisions.md](./docs/decisions.md) ADR-013参照）。

#### プロセスの手動再起動

`uvicorn`（`--reload`）・Vite開発サーバーはコンテナ起動時に自動実行されるため、通常は上記の`docker compose up --build`のみで良い。自動リロードが固まった場合など、プロセスを手動で再起動したい場合はコンテナごと再起動する（`docker compose exec`で同じコマンドを追加実行すると、起動中のプロセスが既にポートを掴んでいるため`Address already in use`になり動作しない）。

```bash
docker compose restart backend
docker compose restart frontend
```

### テスト・静的解析

起動中のコンテナに対して実行する。

```bash
docker compose exec backend pytest                    # 全テスト実行
docker compose exec backend pytest path/to/test.py -v  # 単体テスト
docker compose exec backend ruff check .                # 静的解析
docker compose exec docling pytest                       # doclingサービス（テキスト抽出専用）の全テスト実行
docker compose exec docling ruff check .                  # doclingサービスの静的解析
docker compose exec docling python scripts/verify_docling.py # Docling単体動作検証（環境依存の早期確認）
docker compose exec docling curl -sf -F "file=@tests/fixtures/sample.pdf" http://localhost:8100/convert # /convertを直接叩いて動作確認（ホスト非公開のため、docling自身にexecして呼び出す）
docker compose exec pdf2htmlex pytest                    # pdf2htmlexサービス（レイアウトHTML生成専用）の全テスト実行
docker compose exec pdf2htmlex ruff check .               # pdf2htmlexサービスの静的解析
docker compose exec pdf2htmlex curl -sf -F "file=@tests/fixtures/sample.pdf" http://localhost:8200/convert # /convertを直接叩いて動作確認
docker compose exec frontend npm run test               # Vitest（msw使用、実APIには接続しない）
docker compose exec frontend npm run lint                # ESLint
```

E2E（Playwright）は、frontendの軽量な`node:20-alpine`イメージがブラウザバイナリに非対応（Alpine/musl libc）のため、Microsoft公式のPlaywrightイメージを使う独立サービス`e2e`から実行する（[docs/decisions.md](./docs/decisions.md) ADR-014参照）。常時起動しないよう`profiles`でopt-in化しているため、`--profile e2e`を付けて実行する。

```bash
docker compose --profile e2e run --rm e2e
```

### PDF変換結果を直接ファイルへ出力する（アプリを介さない動作確認）

`backend`のAPI（`/api/render`）を経由せず、各変換サービスの出力を手元のファイルとして確認したい場合の手順。どちらのコンテナもホストへポートを公開していないため、`docker compose exec`でコンテナ内から直接呼び出す。

```bash
# pdf2htmlEX（レイアウトHTML）: PDFをコンテナへコピーし、単一HTMLへ変換して取り出す
docker compose cp "/path/to/input.pdf" pdf2htmlex:/tmp/input.pdf
docker compose exec pdf2htmlex bash -c 'INPUT_DIR=/tmp OUTPUT_DIR=/tmp convert.sh input.pdf'
docker compose cp pdf2htmlex:/tmp/input.html "/path/to/output.html"
open "/path/to/output.html"   # ブラウザでレイアウトの再現度を目視確認できる

# Docling（Markdown）: 同様にコピーして/convertを叩き、markdownフィールドを取り出す
docker compose cp "/path/to/input.pdf" docling:/tmp/input.pdf
docker compose exec -T docling curl -sf -F "file=@/tmp/input.pdf" http://localhost:8100/convert \
  | python3 -c "import json,sys; sys.stdout.write(json.load(sys.stdin)['markdown'])" > "/path/to/output.md"
```

`pdf2htmlex-service/scripts/convert.sh`は`PDF2HTMLEX_ZOOM`・`PDF2HTMLEX_EMBED`・`PDF2HTMLEX_PROCESS_NONTEXT`・`LAST_PAGE`を環境変数で上書きでき、サービス本体（`app/converter.py`）と同じ既定値で動く。変換オプションの効き方を手元のPDFで確かめる用途に使う。

### 型同期

バックエンドの`openapi.json`からフロント用TypeScript型（`frontend/src/types/api.ts`）を再生成する場合は以下を実行する（スキーマ変更時に都度実行する運用。ADR-006）。

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
