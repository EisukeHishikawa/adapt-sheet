# CLAUDE.md

adapt-sheet（帳票作成AI支援プラットフォーム）における ClaudeCode との協働ルール。背景・要件は [`planning/brainstorm.md`](./planning/brainstorm.md)、進め方は [`DEVELOPMENT.md`](./DEVELOPMENT.md) を参照。

## 開発思想

- **TDD徹底**: 実装前に必ずテストコードを書く（Red → Green）。テストなしの実装は行わない。
- **インクリメンタル**: 一気に作らず、最小機能から段階的に肉付けする。フェーズ/ステップは `DEVELOPMENT.md` の順序に従う。
- **インフラ・認証は後回し**: コア体験（AI生成・リアルタイムプレビュー）のローカル完成度を最優先し、インフラ構築・認証・DBはアドオンとして最後に疎結合で組み込む。
- **ドキュメント駆動**: 設計判断や規約変更は口頭で終わらせず、該当するMarkdown（本ファイル、`docs/decisions.md` 等）に反映する。

## ビルド・テストコマンド

> フェーズ2以降、実装が進み次第このセクションを実コマンドで更新する。

### バックエンド (Python / FastAPI)

> Python 3.9系（macOS標準の`python3`）で動作確認済み。Docling 2.x系も同バージョンで動作する。

```bash
cd backend
pytest                    # 全テスト実行
pytest path/to/test.py -v # 単体テスト
ruff check .               # 静的解析
uvicorn app.main:app --reload
```

### フロントエンド (React / TypeScript)

```bash
cd frontend
npm run test        # Vitest
npm run test:e2e     # Playwright
npm run lint         # ESLint
npm run dev
```

## コード規約

- **型安全**: FastAPIの `openapi.json` から自動生成したTypeScript型を使用する。フロント・バック間でキー名を手書きで一致させない。
- **AI呼び出しのモック**: pytest実行時・ローカル開発時にAnthropic APIを実際に叩かない。プロンプトに応じた疑似レスポンスを返すモック層を必ず経由する。
- **固定情報と業務データの分離**: 生成するHTMLにおいて、タイトル等の固定テキストはHTMLへ直書き、明細等の業務データのみテンプレート変数としてJSONと連動させる。
- **エラーハンドリング**: バリデーションエラー・AI生成エラー・Docling解析エラーは、例外種別に応じたHTTPステータスコードを厳格に返す。
- **既存設計の尊重**: 既存コードの設計意図や命名規則を尊重し、必要以上の書き換えを行わない。
- **コードコメント（必須・徹底）**: 新規作成・変更したファイルには、関数/コンポーネント/設定単位で「なぜそう書いたか」を説明するコメントを必ず添える。設定ファイル（`vite.config.ts`, `eslint.config.js` 等）やテストコードも対象。コメントを書き忘れたままコミット・PR作成に進まないこと。コミット・PR作成の直前に、変更したコードファイルにコメントが入っているかを自己チェックする。

## セキュリティ

- `.env` や秘密情報を含むファイルを不用意に表示しない。
- APIキー、トークン、パスワードをコード内に直書きしない。

## 環境依存の注意点

- **Docling**: OS依存のバイナリ/MLモデルを含むため、導入時は単体検証スクリプトで早期に動作確認する。
- **AWS Lambda**: コールドスタート対策として、Doclingモデルはコンテナに事前焼き込みし、AWS Lambda Web Adapterを利用する。
- **ローカルDB**: Supabase統合時は `Supabase Local CLI` / Docker を使い、クラウド環境を汚さずにマイグレーション・テストを行う。

## Git / CI運用

- mainブランチへの直接pushは禁止（Branch Protection）。
- PR作成時・main merge時にフロント（Vitest）・バック（pytest）・静的解析（ESLint/Ruff）のCIを自動実行する運用を予定している。ただし2026-07-05時点でCIワークフローは未構築のため、それまではローカルでのテスト・静的解析結果をPR本文に記載する。CI構築後は100%成功しないとマージ不可とする。
- レビュー承認必須（Require approvals）は、ソロ開発期間中は無効化している（PR作成者本人は自分のPRを承認できないGitHub仕様のため）。共同開発者が加わった時点で再度有効化を検討する。
- **ブランチ命名**: `feat/step{N}-{概要}`（`DEVELOPMENT.md` のステップ番号に対応させる。例: `feat/step2-backend-base`）。
- ブランチを切る前に `main` ブランチを `git pull origin main` で最新化する（サブモジュールがある場合は `git submodule update --remote` も実行）。
- マージ済みのローカルブランチを見つけた場合は削除を提案する。

## GitHub MCP / ギットハブ運用ルール

- 各ステップの実装が完了したら、GitHub MCPを使用して `main` へのプルリクエスト（PR）を作成すること。
- PRのタイトルは `feat: stepX-[タスク名]` の形式に統一すること。
- PR本文は `.github/pull_request_template.md` の項目（概要・やったこと・テスト確認内容・関連ステップ）をすべて埋めて作成すること。
- PRを作成した後は、必ずその差分（Diff）を元に、実装内容の解説をユーザーに行うこと。
- ユーザーの承認（マージの指示）があるまで、自動でマージは行わないこと。
- GitHub MCPのツールは実行前確認ダイアログの説明文が英語表示になるため、ツールを呼び出す前に必ず日本語で「何のために・何を実行するか」を本文中に明記すること。
