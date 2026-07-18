# CLAUDE.md

adapt-sheet（帳票作成AI支援プラットフォーム）における ClaudeCode との協働ルール。背景・要件は [`planning/brainstorm.md`](./planning/brainstorm.md)、進め方は [`DEVELOPMENT.md`](./DEVELOPMENT.md) を参照。

## 開発思想

- **TDD徹底**: 実装前に必ずテストコードを書く（Red → Green）。テストなしの実装は行わない。
- **インクリメンタル**: 一気に作らず、最小機能から段階的に肉付けする。フェーズ/ステップは `DEVELOPMENT.md` の順序に従う。
- **インフラ・認証は後回し**: コア体験（AI生成・リアルタイムプレビュー）のローカル完成度を最優先し、インフラ構築・認証・DBはアドオンとして最後に疎結合で組み込む。
- **ドキュメント駆動**: 設計判断や規約変更は口頭で終わらせず、該当するMarkdown（本ファイル、`docs/decisions.md` 等）に反映する。

## 作業時の確認ルール

- 調査のためのコマンド入力やファイル修正は、都度の確認を挟まず実行してよい。実行後に、実行したコマンドと修正したファイルの差分を最後にまとめて報告すること。
- ただし、ファイル削除・`git push`・本番環境に影響する操作は対象外とし、「Git / CI運用」等の既存ルールに従い事前確認する。

## ビルド・テストコマンド

> フェーズ2以降、実装が進み次第このセクションを実コマンドで更新する。

起動手順（`docker compose up --build`、ポート固定、既存起動時の再作成方法等）は [`README.md`](./README.md) の「クイックスタート」に一本化している。ClaudeCodeがアプリを起動・再起動する際は必ずそちらの手順に従うこと。以下は起動中のコンテナに対して実行するテスト・静的解析コマンド。

### バックエンド (Python / FastAPI、入口エンドポイント)

> Python 3.9系で動作確認済み（`backend/Dockerfile`）。ADR-018によりDocling本体は含まない軽量コンテナ。

```bash
docker compose exec backend pytest                    # 全テスト実行
docker compose exec backend pytest path/to/test.py -v  # 単体テスト
docker compose exec backend ruff check .                # 静的解析
docker compose exec backend python scripts/export_openapi.py # openapi.jsonを書き出す（型同期の入力。ADR-006）
```

### Doclingサービス (Python / FastAPI、テキスト抽出専用・ADR-018/023)

> Python 3.9系で動作確認済み（`docling-service/Dockerfile`）。Docling 2.x系も同バージョンで動作する。backendからHTTPで呼び出される内部サービスのため、ホストへポートは公開しない。ADR-023により、DoclingはMarkdownではなく**HTML**を返す単独の変換エンジン（`engine=docling`）になった（AIへのテキスト入力としては使わない）。

```bash
docker compose exec docling pytest                     # 全テスト実行（実PDF変換の結合テストを含む）
docker compose exec docling pytest path/to/test.py -v   # 単体テスト
docker compose exec docling ruff check .                 # 静的解析
docker compose exec docling python scripts/verify_docling.py # Docling単体動作検証（環境依存の早期確認）
docker compose exec docling curl -sf -F "file=@tests/fixtures/sample.pdf" http://localhost:8100/convert # /convertエンドポイントを直接叩いて動作確認（backend/frontendを介さない）
```

### pdf2htmlex-service (Python / FastAPI、PDF→HTML変換専用・ADR-023)

> Python 3.9系（`pdf2htmlex-service/Dockerfile`）。ベースイメージ`pdf2htmlex/pdf2htmlex`（Ubuntu 20.04/focal、x86_64のみ）にpython3.9を追加導入している。Apple Silicon等のarm64ホストではQEMUエミュレーション下で動作するため、ビルド・実行とも遅い。backendからHTTPで呼び出される内部サービスのため、ホストへポートは公開しない。`engine=pdf2htmlex`選択時に、AIを介さずpdf2htmlEXバイナリの変換結果（フォント・画像・CSSを埋め込んだ自己完結HTML）をそのまま返す単独の変換エンジン。

```bash
docker compose exec pdf2htmlex pytest                     # 全テスト実行（実pdf2htmlEX変換の結合テストを含む）
docker compose exec pdf2htmlex pytest path/to/test.py -v   # 単体テスト
docker compose exec pdf2htmlex ruff check .                 # 静的解析
docker compose exec pdf2htmlex curl -sf -F "file=@tests/fixtures/sample.pdf" http://localhost:8200/convert # /convertエンドポイントを直接叩いて動作確認（backend/frontendを介さない）
```

### レイアウトHTML生成 (PyMuPDF、backend内モジュール・ADR-019/023)

> レイアウトHTML生成はbackend内の純Pythonモジュール（`backend/app/services/pdf_layout.py`、PyMuPDF）が担う（ADR-019）。PDFの1ページ目を、テキスト・罫線・背景を絶対座標のdivへ写した1枚のHTMLに変換する。ADR-023により、この変換結果は単独の変換エンジン（`engine=pymupdf`）としても選択できる（AIを介さない）。専用のテスト・起動コマンドは無く、上記のbackend側コマンド（`docker compose exec backend pytest tests/test_pdf_layout.py -v` 等）で検証する。PyMuPDFはAGPL/商用ライセンスである点に留意（ADR-019のトレードオフ参照）。

### フロントエンド (React / TypeScript)

```bash
docker compose exec frontend npm run test          # Vitest（msw使用、実APIには接続しない）
docker compose exec frontend npm run lint           # ESLint
docker compose exec frontend npm run generate-types  # backend/openapi.json → src/types/api.ts（backend側を先に実行しておく）
docker compose --profile e2e run --rm e2e            # Playwright（frontend/Dockerfile.e2e、専用サービス。ADR-014参照）
```

## コード規約

- **型安全**: FastAPIの `openapi.json` から自動生成したTypeScript型を使用する。フロント・バック間でキー名を手書きで一致させない。
- **AI呼び出しのモック**: pytest実行時・ローカル開発時に生成AI（Gemini/Claude/OpenAI）を実際に叩かない。プロンプトに応じた疑似レスポンスを返すモック層を必ず経由する。pytestの既定は常に`MockAIClient`（`USE_MOCK_AI`未設定時）であり、この既定は`AI_PROVIDER`・`engine`等の他の環境変数/パラメータの値に関わらず変更しない。`USE_MOCK_AI=false`と`AI_PROVIDER=llama`を設定するとOllama（`llama3.2:3b`）経路（`LlamaAIClient`）も利用できるが、Ollama自体はDocker Compose環境にもプロジェクトのセットアップ手順にも含まれていない（ADR-013/014で撤去済み）。使う場合は`OLLAMA_BASE_URL`で到達可能な自前のOllamaインスタンスを別途用意する必要がある（ADR-011）。
- **モデル選択機能（ADR-023）**: 描画エンジンはフロントの`EngineSelect`で選び、`gemini_free`/`gemini`/`claude`/`openai`（生成AI）と`docling`/`pdf2htmlex`/`pymupdf`（AIを介さない変換エンジン）の7種類がある。`gemini`/`claude`/`openai`（標準プラン）はフェーズ5（Auth0導入）まで自由アクセスのユーザーに提供せず、`app/main.py`が最初に403 `FREE_ACCESS_FORBIDDEN`で弾く。生成AIへのリクエストにHTML・JSON・Docling抽出テキストは一切含めず、PDFファイルをマルチモーダル入力として直接添付する（PyMuPDF/Docling経由の事前変換は行わない）。
- **固定情報と業務データの分離**: 生成するHTMLにおいて、タイトル等の固定テキストはHTMLへ直書き、明細等の業務データのみテンプレート変数としてJSONと連動させる。
- **エラーハンドリング**: バリデーションエラー・AI生成エラー・Docling解析エラーは、例外種別に応じたHTTPステータスコードを厳格に返す。
- **既存設計の尊重**: 既存コードの設計意図や命名規則を尊重し、必要以上の書き換えを行わない。
- **コードコメント（簡潔・「なぜ」のみ。ADR-020）**: コメントは「コードを読んでも分からないこと」だけを書く。次の3原則を守る。
  1. **コードそのものに語らせる**: コードを読めば分かることはコメントにしない。命名・関数分割で意図が伝わるなら、コメントは書かずにコードを直す。
  2. **How を書かない**: 処理手順の逐語的な説明は書かない。書くのは「なぜその選択をしたか（Why）」と、コードから読み取れない制約・前提だけ。
  3. **経緯は ADR に置く**: 長い背景・検討の経緯・過去のレビュー履歴はコメントに書かず `docs/decisions.md`（ADR）に書き、コード側は `（ADR-0XX）` と参照するに留める。ステップ番号（「ステップ18で〜」等）や変更履歴もコメントに残さない（Gitログと ADR が一次ソース）。

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
- **ブランチの切り方**: プライマリの作業ディレクトリで `main` を**チェックアウトしない**。`docs-space`（後述、ADR-015）が `main` を保持しており、Gitは同一ブランチを複数のワークツリーで同時にチェックアウトできないため、`git checkout main` は `fatal: 'main' is already used by worktree at ...` で失敗する。最新の`main`から直接ブランチを切ること。

  ```bash
  git fetch origin                                  # リモートの最新をローカルへ取り込む
  git switch -c feat/step{N}-{概要} origin/main      # 最新のmainを起点に新しいブランチを作成
  ```

  そのため、プライマリの作業ディレクトリがブランチ作業の合間に detached HEAD になっているのは**この構成では正常な状態**であり、異常ではない（`main`を載せられないため）。detached HEAD のまま古くなっている場合は `git fetch origin` の後に上記の `git switch -c ... origin/main` を実行すれば、そのまま最新のmainを起点に作業を開始できる。
- **マージ後はプライマリの作業ディレクトリのHEADを最新mainへ進める**: PRを`main`へマージしたら、プライマリの作業ディレクトリ（detached HEAD）を最新の`main`に追従させる。前述のとおり`main`はチェックアウトできないため、`origin/main`をdetached HEADとして取り込む。これによりマージ済みの内容が本体の作業ツリーへ反映され、次のブランチを最新の状態から切れる。

  ```bash
  git fetch origin                    # リモートの最新をローカルへ取り込む
  git checkout --detach origin/main    # detached HEAD を最新mainへ進める（mainはチェックアウトしない）
  ```

- マージ済みのローカルブランチを見つけた場合は削除を提案する。
- **`docs-space`では作業しない**: プロジェクトルート直下の `docs-space`（シンボリックリンク先 `/Users/mina/docs-space`）は `main` ブランチ専用のGit Worktreeであり、常時最新の`main`を読み取り専用で参照するためのものである（ADR-015）。実装作業・ブランチ作成・コミットはプライマリの作業ディレクトリ（このリポジトリ本体）側で行い、`main`をチェックアウトしている`docs-space`配下では行わない。
- **Git Worktree・ブランチは最小構成に保つ（ADR-021）**: 定常状態のGit Worktreeは**プライマリ本体**と**`docs-space`（`main`参照専用）の2つだけ**に保つ。ローカル・リモートのブランチは、`main`と現在作業中のブランチ以外を残さない。
  - **`worktree-*`ブランチを残さない（マージと同時に片付ける）**: バックグラウンドジョブ（Claude Code）がジョブごとに `.claude/worktrees/` へ自動生成する一時Worktreeと `worktree-*` ブランチは、そのPRを `main` へマージしたら**その場で（マージと同時に）削除する**。セッション終了時まで持ち越さない。自分が動作中のWorktreeをマージした場合は、`ExitWorktree`（`remove`）で離脱と削除を行うか、本体側で `git worktree remove --force <path>` と `git branch -D worktree-*` を実行し、リモートも `git push origin --delete worktree-*` で削除する。定常状態で `.claude/worktrees/` は空にする。
  - **マージ済み・不要ブランチは掃除する**: マージ済みのローカルブランチ、およびPRがCLOSED（未マージ）で方針転換により不要になったブランチは、ローカル・リモートとも削除する。リモート削除（`git push --delete`）は「作業時の確認ルール」に従い事前確認する。
  - **点検手段**: `git worktree list`（本体＋`docs-space`の2行のみか）・`git branch`（`main`＋作業中のみか）・`git ls-remote --heads origin`（`main`＋進行中PRのみか）で最小構成を確認する。

## GitHub MCP / ギットハブ運用ルール

- 各ステップの実装が完了したら、GitHub MCPを使用して `main` へのプルリクエスト（PR）を作成すること。
- PRのタイトルは `feat: stepX-[タスク名]` の形式に統一すること。
- PR本文は `.github/pull_request_template.md` の項目（概要・やったこと・テスト確認内容・関連ステップ）をすべて埋めて作成すること。
- PRを作成した後は、必ずその差分（Diff）を元に、実装内容の解説をユーザーに行うこと。
- ユーザーの承認（マージの指示）があるまで、自動でマージは行わないこと。
- GitHub MCPのツールは実行前確認ダイアログの説明文が英語表示になるため、ツールを呼び出す前に必ず日本語で「何のために・何を実行するか」を本文中に明記すること。
