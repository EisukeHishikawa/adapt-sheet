# 開発ロードマップ

本プロジェクトは、エンジニアが保守しやすいHTML/CSSを生成する機能と、リアルタイムプレビューを見ながらHTML帳票を作成できるサイトの開発手順書です。
ClaudeCodeを活用し、**テスト駆動開発（TDD）**で最小限の機能から段階的に肉付けしていく「アジャイルアプローチ」で進めます。

また、AWS Lambdaのコールドスタート対策として**「AWS Lambda Web Adapter」**をインフラのコア要件として組み込み、低コストかつ超高速なサーバーレス環境を実現します（当面のLambda化対象は軽量な入口エンドポイント`backend`のみ）。

---

## 🗺️ 開発ステップ一覧

### 📄 フェーズ 1: ドキュメントと開発基盤の確立
技術スタックの選定思想やルール、アーキテクチャの定義を最初に行い、ClaudeCodeとの共通言語を作ります。
また、この段階でGitHubの基本設定を終わらせます。

#### ⬛ ステップ 1: 6つの主要Markdownドキュメントの作成 & GitHub初期設定
- [x] **GitHub設定:** リポジトリを作成し、mainブランチへの直接プッシュを禁止する保護ルール（Branch Protection Rules）を簡易設定
- [x] `CLAUDE.md` の作成（ClaudeCode用のビルド・テストコマンド、コード規約、開発思想の定義）
- [x] `README.md` の作成（プロジェクト概要、クイックスタート、環境構築手順）
- [x] `docs/spec.md` の作成（要件定義、画面仕様、APIインターフェース、エラーコード定義）
- [x] `docs/architecture.md` の作成（各種概要図をMermaid.jsで記述）
- [x] `docs/decisions.md` の作成（アーキテクチャ決定記録 [ADR]。Terraform一本化の理由、Lambda Web Adapter採用の理由等を記録）
- [x] `docs/deployment.md` の作成（デプロイ手順、環境変数の設定、運用の手引き）

#### ⬛ ステップ 2: バックエンド「超最小」環境とDoclingの検証 【TDD開始】
- [x] Python（FastAPI, SQLAlchemy, pytest）の最小環境セットアップ
- [x] **Docling事前検証:** Doclingをインストールし、ローカル環境（OS依存のライブラリ等）でPDFが最低限テキスト抽出できるかを単体スクリプトで早期検証
- [x] 🧪 **テストコード作成:** ロジック実装前に、`/api/render` にPOSTしたらダミーデータが返るはず、という**期待値のテストを先に記述（Red状態）**
- [x] **最小実装:** テストを通すためだけのモックエンドポイントを最小コードで実装（Green状態）
- [x] 🧪 **ローカルテスト実行:** `pytest` でローカルテストが100%パスすることを確認

---

### 🎨 フェーズ 2: UIの最小実装とリアルタイム連動
画面全部を一気に作らず、「入力したら右側で変わる」というコア体験を最小で実装します。

#### ⬛ ステップ 3: フロントエンド「超最小」環境の構築
- [x] Vite + TypeScript + TailwindCSS + shadcn/ui + ESLint の導入
- [x] `Vitest` + `React Testing Library` のテスト環境構築
- [x] 🧪 **テスト確認:** サンプルコンポーネントに対する単体テストがローカルで動作することを確認

#### ⬛ ステップ 4: 2カラムの超最小画面と状態管理の実装 【フロントTDD】
- [x] 🧪 **テストコード作成:** 「Zustandのストア値を更新したら、プレビュー要素（iframe等）のテキストが切り替わる」という**テストを先に記述**
- [x] **最小実装:** 左：入力、右：リアルタイムプレビューの最小画面とZustandストアを実装
- [x] 🧪 **ローカルテスト実行:** `Vitest` を実行し、リアルタイム連動のロジックが正常にパスすることを確認

#### ⬛ ステップ 5: ローカルでのフロント・バックエンド疎通確認と型同期
- [x] 画面への「描画ボタン」の配置
- [x] **スキーマ型同期設定:** FastAPIのOpenAPI仕様（openapi.json）からフロントエンド用のTypeScript型定義を自動生成するスクリプトを整備（型安全の担保）
- [x] 🧪 **テストコード作成:** ボタン押下時にAPIをフェッチし、ストアにデータが格納される結合テスト（MSW等を利用したモック、またはローカル実機テスト）を記述
- [x] **最小実装:** ボタン押下時のAPIコール処理の実装（生成された型を適用）
- [x] 🧪 **ローカルテスト実行:** フロント・バックを同時に起動し、ダミーデータでの疎通テストをパスさせる

---

### 🧠 フェーズ 3: コア機能（AI・PDF）の肉付け
ClaudeCodeをフル活用し、生成AIとPDF解析のロジックを本物にします。機能追加のたびに「テスト → 実装」を繰り返します。

#### ⬛ ステップ 6: Claude API (Anthropic SDK) の統合
- [x] ⚙️ **環境変数・モック設定:** 開発時やpytest実行時にClaude APIを無駄に消費しないよう、テスト用モック（疑似返却）の仕組みを導入
- [x] 🧪 **テストコード作成:** プレースホルダーを含むHTML/CSS/JSONが厳格に返ってくるかを検証するバリデーション用のテストを先に記述
- [x] **実装:** Anthropic SDKを導入し、動的プロンプト構築ロジックとAI生成処理を実装
- [x] 🧪 **ローカルテスト実行:** テストを実行し、Claudeからのモックレスポンス（またはテスト用生成結果）がバリデーションをパスすることを確認

#### ⬛ ステップ 7: DoclingによるPDF変換機能の追加 【機能拡張】
- [x] 🧪 **テストコード作成:** テスト用PDFファイルを読み込ませたら、HTML文字列に変換されて抽出できるかを検証するバックエンドテストを記述
- [x] **実装:** フロントにドラッグ＆ドロップエリアを配置。バックエンドにDoclingを用いた変換ロジックを実装
- [x] 🧪 **ローカルテスト実行:** PDFアップロードからHTML変換までのテストをパスさせる

#### ⬛ ステップ 8: 画面仕様のコンプリート ＆ UI自動テスト自動化
- [x] 縦幅・横幅自動入力機能、最大10件の履歴スライド機能、エラーメッセージ表示機能をそれぞれ実装
- [x] 🧪 **ブラウザ自動テスト（E2E）:** `Playwright` を導入し、実際にブラウザが立ち上がって「PDFアップロード→描画ボタン押下→履歴が横にスライドする」という一連のユーザー行動をエミュレートする**自動テストシナリオを構築**
- [x] 🧪 **ローカルテスト実行:** すべての機能、コンポーネント、E2Eテストが手元でパスすることを確認

#### ⬛ ステップ 9: Gemini API（google-genai）への移行
- [x] Anthropic Claude APIから無料枠のあるGoogle AI Studio Gemini APIへ全面置換（`AnthropicAIClient`を`GeminiAIClient`に置換）。`AIClient`・`MockAIClient`の契約は不変。関連ドキュメントもGemini前提に更新。

#### ⬛ ステップ 10: ローカル開発用AI経路の追加検証
- [x] ローカル開発でAI生成のバリエーションを確認する第三の経路を検証したが、生成品質が実用水準に届かず不採用とした。

#### ⬛ ステップ 11: Docker Composeによるローカル開発環境の構成
- [x] `docker-compose.yml`と各Dockerfileでfrontend/backendをコンテナ化し、`docker compose up --build`で起動できる環境を構築（ADR-009）。非Docker実行のサポートは終了し、README.md/CLAUDE.mdの手順をDocker Compose前提に統一。E2E（Playwright）はMicrosoft公式イメージを使う独立サービス`e2e`（`profiles: [e2e]`）で実行。

#### ⬛ ステップ 12: Git Worktreeによるmain専用ワークツリーの導入
- [x] `docs-space`という名前でmainブランチ専用のワークツリーを作成し、プロジェクトルートにシンボリックリンクを配置（ADR-010）。

#### ⬛ ステップ 13: 構造化ログ基盤の導入
- [x] 標準`logging`ベースのJSON構造化ログと、リクエスト相関ID（`request_id`）付きミドルウェアを導入（ADR-011）。

#### ⬛ ステップ 14: API通信のエラー設計とフロント表示
- [x] エラーレスポンスを`{"error": {code, message, request_id}}`の構造化エンベロープへ統一し、フロントは`message`を優先表示（ADR-012）。

#### ⬛ ステップ 15: バックエンドの「入口エンドポイント」と「Doclingコンテナ」への分離
- [x] バックエンドを軽量な入口エンドポイント（`backend`）とDocling変換専用の内部サービス（`docling-service`）に分離し、HTTP経由で連携。

#### ⬛ ステップ 16: JSON/プロンプト入力エリアの追加（CSS入力エリアは廃止）
- [x] CSSは常にHTML側`<style>`へ埋め込む前提のため独立のCSS入力欄・`css`リクエストフィールドを廃止し、JSON入力・プロンプト入力の2エディタを追加。

#### ⬛ ステップ 17: サイズ選択ボタンの再設計
- [x] サイズ選択UIを6個の独立ボタンから、実寸比率の紙のイラスト（`PaperSwatch`）付きの1つのSelectへ統合。手動入力時は無印の正方形表示にフォールバック。

#### ⬛ ステップ 18: プレビュー画面サイズの動的変更
- [x] `PreviewPanel`を、用紙サイズを実寸px（96dpi換算）でiframeに組版し、ResizeObserverで測った倍率でscaleする方式に変更（ステップ19と同一PR）。

#### ⬛ ステップ 19: レイアウト変更（縦スクロール対応）
- [x] 2カラム構成へ刷新（左: サイズ操作・PDFドロップ・プロンプト・プレビュー／右: HTML/JSON入力のタブ切り替え）。HTML/JSON入力を`CodeEditor`（prismjs）に刷新。

#### ⬛ ステップ 20: レスポンシブ対応
- [x] 既存ロジックは変更せず、Tailwindのレスポンシブprefix（`md:`）のみでモバイル/タブレット/デスクトップの3レイアウトに対応。

#### ⬛ ステップ 21: UI/UX最高品質化
- [x] ダークモード対応、各コンポーネント（`PdfDropzone`/`PreviewPanel`/`MessageToast`/`HistorySlider`等）の質感向上、履歴クリックで未保存入力が消えるバグの修正、オリジナルファビコン作成。

#### ⬛ ステップ 22: AI生成クオリティ改善＆描画中の経過秒数表示
- [x] `build_prompt`を「視覚的体裁の維持を最優先し、保守性はGeminiに整理させる」役割分担へ書き換え、`MockAIClient`を用紙の向きで出し分け。描画ボタンに経過秒数表示（`RenderingProgress`）を追加。

#### ⬛ ステップ 23: モデル選択機能の追加（生成AI4種＋変換エンジン3種）とPDF直接送信方式への転換
- [x] ⚙️ **設計:** 生成AI4種（Gemini無料/Gemini標準/Claude/OpenAI）と変換エンジン3種（Docling/pdf2htmlEX/PyMuPDF）の役割分担、生成AIへはPDFをマルチモーダル入力として直接添付しHTML/JSON/Doclingテキストは送らない方針、標準プラン（Gemini標準/Claude/OpenAI）はフェーズ5まで自由アクセスのユーザーに提供しないゲート設計を決定。
- [x] 🧪 **テストコード作成:** `build_prompt`がhtml/markdown引数を持たないことを検証する契約テスト、engineごとのゲート403・変換エンジンの直接返却・AIエンジンへのPDFバイト受け渡しを検証するエンドツーエンドテスト（`backend/tests/test_render.py`）、`ClaudeAIClient`/`OpenAIAIClient`の単体テスト、`EngineSelect`のレンダリング・選択・store連動を検証するVitestテストを先に記述。
- [x] **実装（バック）:** `RenderEngine`型・`GATED_ENGINES`等の集合を`ai_client.py`に追加。`build_prompt`からhtml/markdown引数を削除し`has_pdf`フラグに置き換え。`AIClient.generate(prompt, pdf)`にシグネチャ変更し、`GeminiAIClient`/新設`ClaudeAIClient`/`OpenAIAIClient`がPDFバイト列をマルチモーダル入力として直接添付。`app/main.py`にengineゲート判定（403）を追加。DoclingをMarkdownからHTML出力（`export_to_html`）へ変更し単独の変換エンジン化。pdf2htmlEXを専用コンテナ（`pdf2htmlex-service`）として復活させ変換エンジン化。PyMuPDFのレイアウトHTML生成を単独の変換エンジンとして公開。
- [x] **実装（フロント）:** `EngineSelect.tsx`を新設し、描画ボタンの隣に7エンジン（アイコン・ラベル・説明文）を選べるSelectを配置。`sheetStore`に`engine`/`setEngine`を追加し`fetchRender`へ反映。`htmlContent`はリクエストに含めないよう変更。
- [x] 🧪 **ローカルテスト実行:** `pytest`（backend 132件・docling-service 2件・pdf2htmlex-service 5件、全パス）・`ruff`（3サービスとも）・`Vitest`（frontend 96件、全パス）・`ESLint`・`vite build`（tsc型チェック含む）がパスすることを確認。

---

### 🌐 フェーズ 4: インフラ構築とCI/CD 【高速化と自動テストの仕組み化】
アプリがローカルで完璧になった状態で、インフラの構築と同時に、これまで書いたテストを強制する仕組みを作ります。

#### ⬛ ステップ 24: バックエンドのDocker化 ＆ コールドスタート徹底高速化
- [x] **AWS Lambda Web Adapter の導入:** 本番用`backend/Dockerfile.lambda`にWeb Adapterのバイナリ（`COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter...`）を追加し、FastAPIをサーバーレス向けに高速起動化（開発用`backend/Dockerfile`とは別ファイル）
- [x] **APIキーのParameter Store取得（グローバルスコープ・キャッシュ）:** `app/secrets_loader.py`を追加し、Lambdaのコールドスタート時（モジュールimport＝グローバルスコープ）に一度だけParameter StoreからAPIキーを取得して`os.environ`へ展開。ハンドラ内で毎リクエストSSMを叩かず、キーはイメージに焼き込まない
- [x] 🧪 **コンテナ内テスト実行:** Dockerコンテナ内で `pytest` を実行し、環境依存なく高速にテストがパスすることを確認（backend 130件）
- [x] **docling-service/pdf2htmlex-serviceのLambda化:** 両サービスに本番用`Dockerfile.lambda`（Web Adapter導入のみ、開発用Dockerfileと同じ依存構成）を追加。backendからのみ呼ばれる内部専用サービスのため、API Gatewayではなく**AWS_IAM認証必須のLambda Function URL**として公開し、backend Lambdaの実行ロールのみに呼び出しを許可した。backend側は`app/services/remote_extractor.py`でAWS SigV4署名（環境変数`DOCLING_SERVICE_AUTH`/`PDF2HTMLEX_SERVICE_AUTH=aws_sigv4`で有効化）してから呼び出す
- [x] **Terraformのコード化（`infra/`）:** `infra/modules/lambda`をFunction URL作成・IAM呼び出し許可に対応させ再利用可能にした上で、docling/pdf2htmlex用のECR Private・Lambdaモジュール呼び出しを追加。`terraform fmt`はパス済み。ネットワークポリシーでレジストリへ到達できない開発環境のため`terraform validate`/`plan`は未実施（実AWS環境またはレジストリ到達可能な環境で別途確認が必要）
- [x] 🧪 **テストコード追加:** SigV4署名の有無・エラー処理を検証する`backend/tests/test_remote_extractor.py`を追加（`docker compose exec backend pytest`相当、168件全パス）

#### ⬛ ステップ 25: TerraformによるAWSインフラのコード化
> ホスト側で直接実行するツール（Terraform / Node / Python / AWS CLI / Supabase CLI / GitHub CLI）のバージョンは`mise.toml`で固定する（ADR-023）。Terraformは1.15.8、providerは`.terraform.lock.hcl`（コミット対象）で固定。
- [x] ⚙️ **AWS認証情報の設定:** GitHub ActionsからのデプロイをOIDCで行うためのプロバイダとデプロイロールを`infra/modules/github_oidc`で定義（長期アクセスキーは発行しない。許可refは`main`のみ、IAM権限は`adapt-sheet-*`のロールに限定）
- [x] TerraformによるCloudFront + S3、AWS Lambda + API Gateway（ステージ単位のスロットリングで過度なAPIコールを防ぐ。WAFは固定費が高いため不採用）、**ECR Private（Lambdaコンテナは同一リージョンのPrivateからのみ取得可。無料枠500MBの逼迫はライフサイクルで抑制）** をコード定義（`infra/`）。Lambdaのメモリは新規AWSアカウントのデフォルトクォータ上限（3008MB）に合わせている。APIキーはSecureStringのSSM Parameter Storeで管理し、Lambdaの実行ロールに`ssm:GetParameters`/`kms:Decrypt`を最小権限で付与。state土台は`infra/bootstrap`（S3+DynamoDB）
- [x] 🧪 **ステージングテスト:** デプロイ済みの本番エンドポイント（CloudFront配信）に対し、ローカルから`GET /`・`POST /api/warmup`を実行し、フロント配信とbackend→docling/pdf2htmlex/DBの疎通を確認（`{"docling":"ok","pdf2htmlex":"ok","database":"ok"}`）

#### ⬛ ステップ 26: GitHub ActionsによるCI構築 【自動テスト化】
- [x] ⚙️ **GitHub Actions設定:** `.github/workflows/ci.yml` を新設。プルリクエスト（PR）作成時、およびmainブランチへのマージ時に、**「フロントのテスト（Vitest/ESLint/vite build）」「バックのテスト（pytest/ruff）」「docling/pdf2htmlexのテスト（pytest/ruff）」が自動で走るワークフロー**を構築。ローカル開発と同じ`docker-compose.yml`のサービス定義をそのまま使い、ローカル/CIの実行結果が乖離しないようにする（backend/frontendは`--no-deps`で単体起動。backendのテストはDocling/pdf2htmlexクライアントをhttpxモックで検証しており実サービス起動は不要）
- [x] ⚙️ **GitHub設定変更:** mainのブランチ保護ルールに必須ステータスチェック（`backend`/`docling`/`pdf2htmlex`/`frontend`）を追加。`strict`（mainに追従していないブランチはマージ不可）と管理者への強制適用も有効
- [x] ⚙️ **CD構築:** `.github/workflows/cd.yml`を新設。mainへのpushでOIDCによるAWS認証→3イメージのビルド・ECR Privateへのpush（コミットSHAタグ）→`terraform apply`→フロントのS3同期・CloudFront無効化→`POST /api/warmup`によるスモークテストまでを自動化。初回のみ土台をローカルから手動applyする必要がある（`infra/README.md`）

---

### 🔒 フェーズ 5: 認証・認可とデータ保存の追加
最後に、アカウント登録ユーザー向けの機能をアドオンします。ここでもCIが守ってくれる状態で進めます。

- [x] ⚙️ **ローカル検証環境の準備:** Supabase Local CLI（`supabase start`）でAuth・PostgreSQLをローカルに起動し、クラウド環境を作らずに認証・DBを検証できる状態にする（`docs/supabase-local-cli-setup.md`）

#### ⬛ ステップ 27: Supabase Authによる認証・認可の実装
- [x] フロントにSupabase Auth SDK組み込み。バックにJWT認証ミドルウェアを実装（`@supabase/supabase-js`によるemail/passwordログイン、`app/services/auth.py`によるJWT検証。ADR-020）
- [x] ⚙️ **モデル選択機能のゲート解除:** `app/main.py`の`GATED_ENGINES`判定を、未ログイン時のみ403を返すよう条件を差し替える（Gemini標準/Claude/OpenAIクライアント自体はステップ23で実装済み）
- [x] 🧪 **テストコード追加:** 有効なトークンがある場合、ない場合でAPIの挙動が変わることを検証するテストを追加（`backend/tests/test_auth.py`・`backend/tests/test_render.py`・`frontend/src/store/authStore.test.ts`等）。GitHub上のCIで自動実行されることを確認

#### ⬛ ステップ 28: Supabase（PostgreSQL）の統合 ＆ 最終クローズ
- [x] ⚙️ **ローカルDB環境の構築:** docker-compose.ymlへ`db`サービス（Postgres）を追加し、手元の開発環境を汚さずにマイグレーションやテストができる環境を整備（Supabase Local CLIではなく素のPostgresコンテナを選択）
- [x] SQLAlchemy経由でのSupabase接続設定と、データ保存ロジックの実装（`app/db.py`・`app/models.py`・`app/services/history.py`、Alembicマイグレーション`backend/migrations/`。`POST /api/render`成功時にログイン中のユーザーの履歴を自動保存し、`GET /api/history`で一覧取得できる）
- [x] 🧪 **最終結合テスト:** 認証・DB保存・AI生成が絡む全シナリオのテストをPlaywright等で追加（バックエンドのpytest統合テストは追加済み。フロントの保存済み履歴閲覧UI（`HistorySlider`のセッション切れ後の再取得・`HistoryArchive`）はVitest/Testing Libraryで実装・検証済み。`frontend/e2e/auth-history-flow.spec.ts`で、ログイン状態の復元・生成AI系エンジンの非同期ジョブ経路・`HistoryArchive`での履歴取得・ログアウトまでの一連をE2Eで検証）
- [x] 🚀 **本番デプロイ:** CD（`.github/workflows/cd.yml`）がOIDC認証→イメージビルド・push→`terraform apply`→フロント配信→スモークテストまで自動で成功することを確認しプロジェクト完了

#### ⬛ ステップ 29: ログイン専用化とセキュリティ強化
- [x] ⚙️ **ローカル検証環境の整備:** Supabase Local CLIを導入し、JWT検証をJWKS/ES256へ対応（`supabase/config.toml`・`app/services/auth.py`。ADR-020、`docs/supabase-local-cli-setup.md`）
- [x] **新規登録の廃止:** 画面から新規登録導線を削除し、GoTrue側も`enable_signup = false`で自己登録を拒否。アカウント発行は`scripts/create_user.sh`（Admin API）に一本化（ADR-020）
- [x] **Googleアカウントでのログイン:** `signInWithOAuth`と`[auth.external.google]`を追加。未登録アカウントは`enable_signup = false`により弾かれる（ADR-020）
- [x] **セッション管理の改善:** PKCEフロー採用、`onAuthStateChange`の購読解除、復元完了までUIを保留して「チラつき」を防止（ADR-020）
- [x] **XSS対策:** プレビューiframeの`sandbox=""`化（同一オリジン実行によるトークン窃取経路を遮断）、セッション保管を`sessionStorage`へ変更、ビルド成果物へCSPを注入（ADR-020）
- [x] **RLS（行レベルセキュリティ）:** 生成履歴をSupabaseのPostgresへ統合し、`auth.uid()`ベースのポリシーを定義。アプリは`authenticator`→`authenticated`ロールで接続する（ADR-020）
- [x] 🧪 **テストコード追加:** `backend/tests/test_db_rls.py`、`frontend/src/store/authStore.test.ts`・`AuthPanel.test.tsx`の更新（新規登録の非提供・Googleログイン・チラつき防止・購読解除）

#### ⬛ ステップ 30: ログイン手段のGoogleアカウント限定
- [x] **パスワードログインの廃止:** `[auth.email] enable_signup = false`でGoTrueのメール認証を無効化し、`authStore.signInWithPassword`と`AuthPanel`の入力欄を削除。UIは「Googleでログイン」のみ（ADR-020）
- [x] **アカウント作成のガード:** `scripts/create_user.sh`はGoogle OAuth未設定・`env(...)`未展開・GoTrue側でgoogle無効のいずれでも作成を拒否する。パスワードは設定しない（ADR-020）
- [x] **ローカル検証手順の整備:** `.env`読み込み後に`supabase start`する順序を明示（`env(...)`展開のため必須）、Google Cloudでのクライアント発行手順を追加（`docs/supabase-local-cli-setup.md`）
- [x] 🧪 **Googleログインの実動作確認:** 実際のGoogle Cloud OAuthクライアントでログインに成功。既存アカウント（`email` identity）へ`google` identityが自動連携されることも`auth.identities`で確認済み

---

### 🛠️ フェーズ 6: 本番運用後の改善
本番デプロイ後の実機検証で見つかった課題への対応。

#### ⬛ ステップ 31: 生成AI描画のジョブ非同期化（API Gatewayの29秒制約回避）
- [x] ⚙️ **非同期ジョブ基盤の構築:** S3（`infra/modules/job_bucket`、1日で自動失効、CORS設定込み）と、backendと同じイメージを再利用する`render-worker` Lambda（`infra/main.tf`の`module "lambda_render_worker"`、既存の`infra/modules/lambda`を再利用。API Gateway/Function URLなし、タイムアウト180秒）を追加（ADR-031）
- [x] **backend: 非同期エンドポイントの実装:** `POST /api/render/upload-url`・`POST /api/render/jobs`・`GET /api/render/jobs/{job_id}`・`POST /internal/render-jobs/process`を追加（`app/services/job_store.py`・`app/services/worker_invoker.py`）。既存の`POST /api/render`のAI生成ロジックは`_generate_ai_result`として抽出し、同期・非同期の両経路で共用する
- [x] **frontend: ポーリング対応:** `sheetStore.fetchRender`を生成AI系engineと変換エンジンで分岐し、生成AI系はS3への直接アップロード→ジョブ起動→2秒間隔のポーリングへ変更（`lib/api.ts`）
- [x] 🧪 **テストコード追加:** `backend/tests/test_job_store.py`・`test_worker_invoker.py`・`test_render_jobs.py`、`frontend/src/store/sheetStore.test.ts`のポーリングテスト（`vi.useFakeTimers`）を追加
- [x] 🚀 **実機不具合の修正:** 実AWS環境での検証で見つかった4件を個別に修正
  - Geminiクライアントのタイムアウトが20秒のままで（旧・API Gatewayの29秒制約に合わせた設定）毎回504になっていた問題を150秒へ延長
  - S3署名付きアップロードURLへのCORS設定漏れ
  - S3署名付きURLがグローバルエンドポイントで発行され307リダイレクトが発生していた問題（リージョナルエンドポイントを明示）
  - フロントのCSP（`connect-src`）にS3オリジンが未許可だった問題
  - Geminiが稀に返す構文的に不正なJSONをリトライ対象に追加

#### ⬛ ステップ 32: Gemini無料枠の利用回数表示
- [x] `gemini_free_usage`テーブル（全ユーザー共有・JST日次リセットのカウンタ）を追加し、`gemini_free`/`hybrid`エンジン（いずれも同じ無料枠モデルを使う）での描画成功時（同期・非同期ジョブ双方）にカウントする。個人データを持たないためRLS非適用、未ログイン時の`authenticator`ロールにもGRANTし匿名利用も計測対象にする。
- [x] `GET /api/usage/gemini-free`（認証不要）で当日の利用回数・上限を返す。上限到達時も`gemini_free`/`hybrid`エンジンの利用はブロックしない。
- [x] フロント: 描画ボタン押下でgemini_free/hybrid描画が成功した際、成功メッセージへ「本日x/10回」を付加して表示する（`sheetStore.fetchRender`）。
- [x] 🧪 **テストコード追加:** `backend/tests/test_gemini_usage.py`（カウンタのincrement/取得）、`backend/tests/test_render.py`・`test_render_jobs.py`（匿名利用でのincrement・hybridでもincrementすること・変換エンジンでは増えないこと・DB失敗時も描画は成功すること・エンドポイントの認証不要性）、`frontend/src/store/sheetStore.test.ts`（成功メッセージへの付加・hybridでも付加されること・取得失敗時のフォールバック）を追加。
- [x] 🧪 **ローカルテスト実行:** `pytest`（backend 239件、全パス）・`ruff`・`Vitest`（frontend 171件、全パス）・`ESLint`・`vite build`がパス。ローカルSupabase（Docker Compose経由）に対しAlembicマイグレーションを適用し、`curl`で匿名リクエストによるカウンタ増分（0→1）を実機確認済み。
- [x] **ローカルでの生成AI系engine検証環境の整備:** 上記の実機確認中に、生成AI系engine（ADR-031の非同期ジョブ経路）がローカルのdocker-compose環境では一切動作しない既存の制約が判明したため対応（ADR-031へ追記）。`docker-compose.yml`にS3互換のMinIO（`minio`/`minio-init`サービス）を追加し、`job_store.S3JobStore`にエンドポイントの上書き（`RENDER_JOBS_S3_ENDPOINT_URL`/`RENDER_JOBS_S3_PUBLIC_ENDPOINT_URL`）を追加。`worker_invoker.py`にはrender-worker Lambdaの代わりにbackend自身へHTTP POSTする`LocalHttpWorkerInvoker`を追加し、`RENDER_WORKER_LOCAL_URL`設定時のみ使う。本番向けクラス（`S3JobStore`・`LambdaWorkerInvoker`）自体は無変更。
- [x] 🧪 **テストコード追加:** `backend/tests/test_job_store.py`（エンドポイント上書き・path-styleアドレッシング切り替え・presign用クライアントの分離）、`backend/tests/test_worker_invoker.py`（`LocalHttpWorkerInvoker`のPOST送信・非ブロッキング起動・接続エラーの握りつぶし・ファクトリの選択）を追加。
- [x] 🧪 **ローカルテスト実行:** `pytest`（backend 247件、全パス）・`ruff`がパス。ホストから実際にpresigned URLへPUTでPDFをアップロードし、`hybrid`エンジンの非同期ジョブが`status: "done"`まで完了することをブラウザと同じ経路（ホスト→MinIO直接PUT）で実機確認済み。
- [x] **エラーメッセージの細分化:** PDF未添付（変換エンジン/`hybrid`）が一律400 VALIDATION_ERRORの汎用文言だったため、専用の`428 Precondition Required`/`PDF_REQUIRED`を新設し「このエンジンを使うにはPDFファイルの添付が必要です。ファイルを選択してください。」を返すよう分離（`docs/spec.md` 4章のエラーカタログを更新）。
- [x] 🧪 **テストコード更新:** `backend/tests/test_render.py`・`test_render_jobs.py`（PDF未添付時の期待ステータスを400→428へ、エラーメッセージ文言を更新）、`frontend/src/store/sheetStore.test.ts`（428のケースを追加）。
- [x] 🧪 **ローカルテスト実行:** `pytest`（backend 247件、全パス）・`ruff`・`Vitest`（frontend 172件、全パス）・`ESLint`がパス。`curl`で実際に428・`PDF_REQUIRED`・専用文言が返ることを実機確認済み。
