# adapt-sheet

エンジニアが保守しやすいHTML/CSS帳票を、AIの力で構築・管理するプラットフォーム。既存PDFの解析（Docling）とClaude APIによる生成、リアルタイムプレビューを統合したSPA。

詳細な構想・要件は [`planning/brainstorm.md`](./planning/brainstorm.md)、開発の進め方は [`DEVELOPMENT.md`](./DEVELOPMENT.md) を参照。

## 技術スタック

- **フロントエンド**: React / TypeScript / Vite / Zustand / shadcn/ui / TailwindCSS
- **バックエンド**: Python / FastAPI / Docling / Anthropic SDK / SQLAlchemy
- **テスト**: Vitest + React Testing Library / pytest / Playwright
- **インフラ**: Terraform / AWS (Lambda, CloudFront, S3, API Gateway, WAF) / GitHub Actions
- **認証・DB**: Auth0 / Supabase (PostgreSQL)

## クイックスタート

> 各セットアップ手順はフェーズ2・3の実装が進み次第、随時追記する。

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
uvicorn app.main:app --reload
```

### フロントエンド

```bash
cd frontend
npm install
npm run dev
npm run test
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
