# 開発ロードマップ

AdaptSheet AIをどの順序で作ったかの記録。フェーズ単位で「コア体験 → インフラ → 認証・DB」の順に進め、各ステップはテスト駆動開発（TDD）で実装した。

ブランチ名はここでのステップ番号に対応させる（`feat/step{N}-{概要}`。[`CLAUDE.md`](./CLAUDE.md) のGit運用ルール参照）。技術選定の理由は [`docs/decisions.md`](./docs/decisions.md)、現在の仕様は [`docs/spec.md`](./docs/spec.md) を参照。

---

## フェーズ 1: ドキュメントと開発基盤の確立

技術選定思想・ルール・アーキテクチャを先に定義し、ClaudeCodeとの共通言語を作る。

### ステップ 1: 主要Markdownドキュメントの作成 & GitHub初期設定
- [x] リポジトリ作成とmainブランチの保護ルール（Branch Protection Rules）設定
- [x] `CLAUDE.md` / `README.md` / `docs/spec.md` / `docs/architecture.md` / `docs/decisions.md` / `docs/deployment.md` の作成

### ステップ 2: バックエンド「超最小」環境とDoclingの検証
- [x] Python（FastAPI, SQLAlchemy, pytest）の最小環境セットアップ
- [x] Doclingの単体スクリプトによる事前検証（OS依存ライブラリの早期確認）
- [x] `/api/render` のテストを先に書き、通すだけのモックエンドポイントを実装

---

## フェーズ 2: UIの最小実装とリアルタイム連動

画面全体を作らず、「入力したら右側で変わる」というコア体験を最小で実装する。

### ステップ 3: フロントエンド「超最小」環境の構築
- [x] Vite + TypeScript + TailwindCSS + shadcn/ui + Biome の導入
- [x] Vitest + React Testing Library のテスト環境構築

### ステップ 4: 2カラムの超最小画面と状態管理の実装
- [x] 「ストア値の更新でプレビューが切り替わる」テストを先に書き、Zustandストアと2カラム画面を実装

### ステップ 5: フロント・バックエンドの疎通確認と型同期
- [x] 描画ボタンの配置と、押下時のAPIコール処理の実装
- [x] FastAPIの`openapi.json`からTypeScript型を自動生成するスクリプトを整備（型安全の担保）

---

## フェーズ 3: コア機能（AI・PDF）の肉付け

生成AIとPDF解析のロジックを本物にする。機能追加のたびに「テスト → 実装」を繰り返す。

### ステップ 6: Claude API (Anthropic SDK) の統合
- [x] 実APIを叩かないモック層の導入と、HTML/CSS/JSONの形式を検証するバリデーションテストの整備
- [x] 動的プロンプト構築ロジックとAI生成処理の実装

### ステップ 7: DoclingによるPDF変換機能の追加
- [x] フロントのドラッグ＆ドロップエリアと、バックエンドのDocling変換ロジックを実装

### ステップ 8: 画面仕様のコンプリート ＆ E2Eテストの自動化
- [x] 縦幅・横幅自動入力、最大10件の履歴スライド、エラーメッセージ表示を実装
- [x] Playwrightを導入し「PDFアップロード→描画→履歴スライド」の一連をE2Eで自動検証

### ステップ 9: Gemini API（google-genai）への移行
- [x] 無料枠のあるGemini APIへ全面置換（`AnthropicAIClient`→`GeminiAIClient`）。`AIClient`・`MockAIClient`の契約は不変

### ステップ 10: ローカル開発用AI経路の追加検証
- [x] 第三のAI経路を検証したが、生成品質が実用水準に届かず不採用

### ステップ 11: Docker Composeによるローカル開発環境の構成
- [x] frontend/backendをコンテナ化し`docker compose up --build`で起動する構成へ統一。非Docker実行のサポートは終了
- [x] E2E（Playwright）はMicrosoft公式イメージを使う独立サービス`e2e`（`profiles: [e2e]`）で実行

### ステップ 12: Git Worktreeによるmain専用ワークツリーの導入
- [x] `main`専用ワークツリー`docs-space`を作成し、プロジェクトルートにシンボリックリンクを配置

### ステップ 13: 構造化ログ基盤の導入
- [x] 標準`logging`ベースのJSON構造化ログと、リクエスト相関ID（`request_id`）付きミドルウェアを導入

### ステップ 14: API通信のエラー設計とフロント表示
- [x] エラーレスポンスを`{"error": {code, message, request_id}}`へ統一し、フロントは`message`を優先表示

### ステップ 15: バックエンドの「入口エンドポイント」と「Doclingコンテナ」への分離
- [x] 軽量な入口（`backend`）とDocling変換専用の内部サービス（`docling-service`）へ分離し、HTTP経由で連携

### ステップ 16: JSON/プロンプト入力エリアの追加（CSSリクエストフィールドは廃止）
- [x] CSSは常にHTML側`<style>`へ埋め込む前提のため`css`リクエストフィールドを廃止し、JSON入力・プロンプト入力を追加

### ステップ 17: サイズ選択ボタンの再設計
- [x] 6個の独立ボタンから、実寸比率の紙のイラスト（`PaperSwatch`）付きの1つのSelectへ統合

### ステップ 18: プレビュー画面サイズの動的変更
- [x] 用紙サイズを実寸px（96dpi換算）でiframeに組版し、ResizeObserverで測った倍率でscaleする方式へ変更

### ステップ 19: レイアウト変更（縦スクロール対応）
- [x] 2カラム構成へ刷新（左: サイズ操作・PDFドロップ・プロンプト・プレビュー／右: HTML/CSS/JSONタブ）
- [x] HTML/JSON入力を`CodeEditor`（prismjs）へ刷新

### ステップ 20: レスポンシブ対応
- [x] 既存ロジックは変更せず、Tailwindの`md:`prefixのみでモバイル/タブレット/デスクトップの3レイアウトに対応

### ステップ 21: UI/UX最高品質化
- [x] ダークモード対応、各コンポーネントの質感向上、履歴クリックで未保存入力が消えるバグの修正、ファビコン作成

### ステップ 22: AI生成クオリティ改善＆描画中の経過秒数表示
- [x] `build_prompt`を「視覚的体裁の維持を最優先し、保守性はAI側に整理させる」役割分担へ書き換え
- [x] 描画ボタンに経過秒数表示（`RenderingProgress`）を追加

### ステップ 23: モデル選択機能の追加（生成AI4種＋変換エンジン3種）とPDF直接送信方式への転換
- [x] 生成AIへはPDFをマルチモーダル入力として直接添付し、事前変換したHTML/テキストは送らない方針へ転換
- [x] `ClaudeAIClient`/`OpenAIAIClient`を追加。Doclingを単独の変換エンジン化（HTML出力）、pdf2htmlEXを専用コンテナで復活、PyMuPDFのレイアウト変換を公開
- [x] 標準プラン（Gemini標準/Claude/OpenAI）は`app/main.py`で403を返すゲートを実装（フェーズ5で未ログイン時のみへ緩和）
- [x] フロントに`EngineSelect`を新設し、描画ボタンの隣で7エンジンを選べるようにした

---

## フェーズ 4: インフラ構築とCI/CD

アプリがローカルで完成した状態で、インフラを構築し、これまで書いたテストを強制する仕組みを作る。

### ステップ 24: バックエンドのDocker化 ＆ コールドスタート徹底高速化
- [x] 本番用`Dockerfile.lambda`にAWS Lambda Web Adapterを導入し、FastAPIをサーバーレス向けに高速起動化
- [x] APIキーをコールドスタート時にParameter Storeから取得する`app/secrets_loader.py`を追加（イメージに焼き込まない）
- [x] docling/pdf2htmlexはAWS_IAM認証必須のLambda Function URLとして公開し、backendはSigV4署名で呼び出す

### ステップ 25: TerraformによるAWSインフラのコード化
- [x] CloudFront + S3、Lambda + API Gateway（ステージ単位スロットリング。WAFは固定費が高いため不採用）、ECR Private、SSM Parameter Storeを`infra/`に定義
- [x] GitHub ActionsのOIDCプロバイダとデプロイロールを定義（長期アクセスキーは発行しない）
- [x] state土台は`infra/bootstrap`（S3+DynamoDB）。ツールのバージョンは`mise.toml`と`.terraform.lock.hcl`で固定
- [x] 本番エンドポイントへ`GET /`・`POST /api/warmup`を実行し、フロント配信とbackend→docling/pdf2htmlex/DBの疎通を確認

### ステップ 26: GitHub ActionsによるCI/CD構築
- [x] `.github/workflows/ci.yml`: PR作成時・mainマージ時にフロント・バックのテストを自動実行。ローカルと同じ`docker-compose.yml`を使い実行結果を乖離させない
- [x] mainのブランチ保護に必須ステータスチェック（`backend`/`frontend`）と`strict`を設定
- [x] `.github/workflows/cd.yml`: mainへのpushでOIDC認証→イメージのビルド・push→`terraform apply`→フロントのS3同期・CloudFront無効化→スモークテストまでを自動化

---

## フェーズ 5: 認証・認可とデータ保存の追加

アカウント登録ユーザー向けの機能をアドオンする。CIが守ってくれる状態で進める。

### ステップ 27: Supabase Authによる認証・認可の実装
- [x] フロントにSupabase Auth SDKを組み込み、バックエンドにJWT検証（`app/services/auth.py`）を実装
- [x] 標準プランのゲートを「未ログイン時のみ403」へ緩和

### ステップ 28: Supabase（PostgreSQL）の統合
- [x] docker-compose.ymlへ`db`サービスを追加し、手元の環境を汚さずマイグレーション・テストできる状態を整備
- [x] `POST /api/render`成功時にログイン中のユーザーの履歴を自動保存し、`GET /api/history`で一覧取得（Alembicで管理）
- [x] 履歴閲覧UI（`HistorySlider`の再取得・`HistoryArchive`）と、ログインから履歴取得までのE2Eを追加

### ステップ 29: ログイン専用化とセキュリティ強化
- [x] JWT検証をJWKS/ES256へ対応。Supabase Local CLIでのローカル検証手順を整備
- [x] 新規登録の廃止（`enable_signup = false`）とGoogleアカウントでのログイン、PKCEフローの採用
- [x] XSS対策: プレビューiframeの`sandbox=""`化、セッション保管の`sessionStorage`化、ビルド成果物へのCSP注入
- [x] 生成履歴に`auth.uid()`ベースのRLSポリシーを定義し、`authenticator`→`authenticated`ロールで接続

### ステップ 30: ログイン手段のGoogleアカウント限定
- [x] メール認証を無効化し、UIを「Googleでログイン」のみに。`scripts/create_user.sh`はパスワードを設定しない
- [x] `create_user.sh`はGoogle OAuth未設定時にアカウント作成を拒否し、ログイン不能なアカウントが増えるのを防ぐ

---

## フェーズ 6: 本番運用後の改善

本番デプロイ後の実機検証で見つかった課題への対応。

### ステップ 31: 生成AI描画のジョブ非同期化（API Gatewayの29秒制約回避）
- [x] S3（1日で自動失効）と`render-worker` Lambda（backendと同じイメージ、タイムアウト180秒）を追加
- [x] `POST /api/render/upload-url`・`POST /api/render/jobs`・`GET /api/render/jobs/{job_id}`を追加。AI生成ロジックは同期・非同期の両経路で共用
- [x] フロントは生成AI系エンジンのみ、S3への直接アップロード→ジョブ起動→2秒間隔のポーリングへ変更

### ステップ 32: Gemini無料枠の利用回数表示
- [x] 全ユーザー共有・JST日次リセットのカウンタ（`gemini_free_usage`）を追加し、`gemini_free`/`hybrid`の描画成功時にカウント。個人データを持たないためRLS非適用で、匿名利用も計測対象にする
- [x] `GET /api/usage/gemini-free`（認証不要）で当日の利用回数・上限を返す。上限到達後もブロックはしない
- [x] 描画成功時のメッセージへ「本日x/10回」を付加
- [x] ローカルでの生成AI系エンジン検証環境の整備: S3の代わりにMinIOを、render-worker Lambdaの代わりにbackend自身へのHTTP POSTを使う（本番向けクラスは無変更）
- [x] PDF未添付のエラーを汎用の400から専用の`428 PDF_REQUIRED`へ分離
