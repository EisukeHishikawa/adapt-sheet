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

## 環境依存の注意点

- **Docling**: OS依存のバイナリ/MLモデルを含むため、導入時は単体検証スクリプトで早期に動作確認する。
- **AWS Lambda**: コールドスタート対策として、Doclingモデルはコンテナに事前焼き込みし、AWS Lambda Web Adapterを利用する。
- **ローカルDB**: Supabase統合時は `Supabase Local CLI` / Docker を使い、クラウド環境を汚さずにマイグレーション・テストを行う。

## Git / CI運用

- mainブランチへの直接pushは禁止（Branch Protection）。
- PR作成時・main merge時にフロント（Vitest）・バック（pytest）・静的解析（ESLint/Ruff）のCIが自動実行される。CIが100%成功しないとマージ不可。
