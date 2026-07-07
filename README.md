# adapt-sheet

エンジニアが保守しやすいHTML/CSS帳票を、AIの力で構築・管理するプラットフォーム。既存PDFの解析（Docling）とClaude APIによる生成、リアルタイムプレビューを統合したSPA。

詳細な構想・要件は [`planning/brainstorm.md`](./planning/brainstorm.md)、開発の進め方は [`DEVELOPMENT.md`](./DEVELOPMENT.md) を参照。

## 技術スタック

- **フロントエンド**: React / TypeScript / Vite / Zustand / shadcn/ui / TailwindCSS
- **バックエンド**: Python / FastAPI / Docling / Anthropic SDK / SQLAlchemy
- **型同期**: openapi-typescript（FastAPIの`openapi.json`からフロント用TypeScript型を生成。ADR-006参照）
- **テスト**: Vitest + React Testing Library + MSW / pytest / Playwright
- **インフラ**: Terraform / AWS (Lambda, CloudFront, S3, API Gateway, WAF) / GitHub Actions
- **認証・DB**: Auth0 / Supabase (PostgreSQL)

## クイックスタート

> 各セットアップ手順はフェーズ2・3の実装が進み次第、随時追記する。

### Docker Composeでのクイックスタート（推奨）

venvを手動セットアップせずに、frontend・backendの2コンテナを一括起動できる。

```bash
docker compose up --build
```

- フロントエンド: http://localhost:5173
- バックエンド: http://localhost:8000

backend/frontendはそれぞれ`./backend`・`./frontend`をコンテナへバインドマウントしているため、ホスト側でのコード編集はホットリロードされる。AI生成は既定で`USE_MOCK_AI=true`（`MockAIClient`）を使う構成にしている。実Gemini APIを使いたい場合は`docker-compose.yml`の`backend.environment`を`USE_MOCK_AI=false`・`AI_PROVIDER=gemini`・`GEMINI_API_KEY`に上書きする。

> 当初はOllama（`llama3.2:3b`）コンテナも構成していたが、Docling抽出後の長いプロンプトに対してJSON整形が安定せず`/api/render`が頻繁に502で失敗したため廃止した（[docs/decisions.md](./docs/decisions.md) ADR-013参照）。Dockerを使わない手動セットアップでのOllamaローカル利用（下記「バックエンド」節）は引き続き利用可能。

### 手動セットアップ（venv / npm install）

Dockerを使わない場合は以下の手順でセットアップする。

### 前提ツール（ローカル開発）

- **Homebrew**: `gh` 等のパッケージ管理に使用（[brew.sh](https://brew.sh)）
- **GitHub CLI (`gh`)**: リポジトリ作成・PR作成・Branch Protection設定に使用。`brew install gh` 後 `gh auth login` で認証
- **Python 3.9系**（macOS標準の`python3`で動作確認済み。Doclingも同バージョンで動作）

### バックエンド

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest
uvicorn app.main:app --reload   # ポート8000で起動（frontendのViteプロキシ先）
```

> `/api/render`はデフォルトでモックAIクライアント（`USE_MOCK_AI`未設定時）を使用するため、`GEMINI_API_KEY`が無くてもローカルで動作する。実際のGemini APIを呼び出す場合は`USE_MOCK_AI=false`と`GEMINI_API_KEY`を設定する（詳細は[docs/deployment.md](./docs/deployment.md)、ADR-007・ADR-010参照）。ローカルでAI生成のバリエーションを確認したい場合は、`USE_MOCK_AI=false`と`AI_PROVIDER=llama`を設定するとAPIキー不要でOllama（`llama3.2:3b`）経由の生成を試せる（ADR-011）。

### フロントエンド

```bash
cd frontend
npm install
npm run dev
npm run test
```

> `npm run dev` はVite開発サーバーの`/api`パスをバックエンド（`http://localhost:8000`）へプロキシする設定済み（`vite.config.ts`）。描画ボタンでの疎通確認にはバックエンドの同時起動が必要。
>
> `openapi-typescript`のpeer dependencyがTypeScript 6系に未対応のため、`npm install`時に警告が出る場合は`npm install --force`を使用する（詳細はADR-006）。

### フロント・バック同時起動時の型同期

バックエンドの`openapi.json`からフロント用TypeScript型（`frontend/src/types/api.ts`）を再生成する場合は以下を実行する（スキーマ変更時に都度実行する運用。ADR-006）。

```bash
cd backend && source .venv/bin/activate && python scripts/export_openapi.py
cd frontend && npm run generate-types
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
