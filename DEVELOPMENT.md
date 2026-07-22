# 開発ロードマップ

本プロジェクトは、エンジニアが保守しやすいHTML/CSSを生成する機能と、リアルタイムプレビューを見ながらHTML帳票を作成できるサイトの開発手順書です。
ClaudeCodeを活用し、**テスト駆動開発（TDD）**で最小限の機能から段階的に肉付けしていく「アジャイルアプローチ」で進めます。

また、AWS Lambdaのコールドスタート対策として**「AWS Lambda Web Adapter」**をインフラのコア要件として組み込み、低コストかつ超高速なサーバーレス環境を実現します（当面のLambda化対象は軽量な入口エンドポイント`backend`のみ。ADR-017参照）。

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
- [x] ローカル開発でAI生成のバリエーションを確認する第三の経路を追加検証したが、生成品質が実用水準に届かず、Docker Compose構成（ステップ11）で撤去した。

#### ⬛ ステップ 11: Docker Composeによるローカル開発環境の構成
- [x] `docker-compose.yml`と各Dockerfileでfrontend/backendをコンテナ化し、`docker compose up --build`で起動できる環境を構築（ADR-009）。非Docker実行のサポートは終了し、README.md/CLAUDE.mdの手順をDocker Compose前提に統一。E2E（Playwright）はMicrosoft公式イメージを使う独立サービス`e2e`（`profiles: [e2e]`）で実行。

#### ⬛ ステップ 12: Git Worktreeによるmain専用ワークツリーの導入
- [x] `docs-space`という名前でmainブランチ専用のワークツリーを作成し、プロジェクトルートにシンボリックリンクを配置（ADR-010）。

#### ⬛ ステップ 13: 構造化ログ基盤の導入
- [x] 標準`logging`ベースのJSON構造化ログと、リクエスト相関ID（`request_id`）付きミドルウェアを導入（ADR-011）。

#### ⬛ ステップ 14: API通信のエラー設計とフロント表示
- [x] エラーレスポンスを`{"error": {code, message, request_id}}`の構造化エンベロープへ統一し、フロントは`message`を優先表示（ADR-012）。

#### ⬛ ステップ 15: バックエンドの「入口エンドポイント」と「Doclingコンテナ」への分離
- [x] バックエンドを軽量な入口エンドポイント（`backend`）とDocling変換専用の内部サービス（`docling-service`）に分離し、HTTP経由で連携（ADR-013）。

#### ⬛ ステップ 16: JSON/プロンプト入力エリアの追加（CSS入力エリアは廃止）
- [x] CSSは常にHTML側`<style>`へ埋め込む前提のため独立のCSS入力欄・`css`リクエストフィールドを廃止し、JSON入力・プロンプト入力の2エディタを追加（ADR-014）。

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
- [x] `build_prompt`を「視覚的体裁の維持を最優先し、保守性はGeminiに整理させる」役割分担へ書き換え、`MockAIClient`を用紙の向きで出し分け（ADR-014）。描画ボタンに経過秒数表示（`RenderingProgress`）を追加。

#### ⬛ ステップ 23: モデル選択機能の追加（生成AI4種＋変換エンジン3種）とPDF直接送信方式への転換
> DEVELOPMENT.mdの当初計画には無く、ユーザーからの追加要望（「描画ボタンの横で生成エンジンを選べるようにしたい」「生成AIへHTML/JSON/Doclingテキストを送らないようにしたい」）を受けて追記した。ADR-015参照。
- [x] ⚙️ **設計:** `docs/decisions.md`にADR-015として記録。生成AI4種（Gemini無料/Gemini標準/Claude/OpenAI）と変換エンジン3種（Docling/pdf2htmlEX/PyMuPDF）の役割分担、生成AIへはPDFをマルチモーダル入力として直接添付しHTML/JSON/Doclingテキストは送らない方針、標準プラン（Gemini標準/Claude/OpenAI）はフェーズ5まで自由アクセスのユーザーに提供しないゲート設計を決定。
- [x] 🧪 **テストコード作成:** `build_prompt`がhtml/markdown引数を持たないことを検証する契約テスト、engineごとのゲート403・変換エンジンの直接返却・AIエンジンへのPDFバイト受け渡しを検証するエンドツーエンドテスト（`backend/tests/test_render.py`）、`ClaudeAIClient`/`OpenAIAIClient`の単体テスト、`EngineSelect`のレンダリング・選択・store連動を検証するVitestテストを先に記述。
- [x] **実装（バック）:** `RenderEngine`型・`GATED_ENGINES`等の集合を`ai_client.py`に追加。`build_prompt`からhtml/markdown引数を削除し`has_pdf`フラグに置き換え。`AIClient.generate(prompt, pdf)`にシグネチャ変更し、`GeminiAIClient`/新設`ClaudeAIClient`/`OpenAIAIClient`がPDFバイト列をマルチモーダル入力として直接添付。`app/main.py`にengineゲート判定（403）を追加。DoclingをMarkdownからHTML出力（`export_to_html`）へ変更し単独の変換エンジン化。pdf2htmlEXを専用コンテナ（`pdf2htmlex-service`）として復活させ変換エンジン化。PyMuPDFのレイアウトHTML生成を単独の変換エンジンとして公開。
- [x] **実装（フロント）:** `EngineSelect.tsx`を新設し、描画ボタンの隣に7エンジン（アイコン・ラベル・説明文）を選べるSelectを配置。`sheetStore`に`engine`/`setEngine`を追加し`fetchRender`へ反映。`htmlContent`はリクエストに含めないよう変更。
- [x] 🧪 **ローカルテスト実行:** `pytest`（backend 132件・docling-service 2件・pdf2htmlex-service 5件、全パス）・`ruff`（3サービスとも）・`Vitest`（frontend 96件、全パス）・`ESLint`・`vite build`（tsc型チェック含む）がパスすることを確認。
- **ステップ番号の対応（リナンバリング注記）**: 本ステップの差し込みに伴い、旧ステップ23〜27はステップ24〜28へ繰り下げた（未着手のフェーズ4・5が対象のため、実施済みステップの記録には影響しない）。

---

### 🌐 フェーズ 4: インフラ構築とCI/CD 【高速化と自動テストの仕組み化】
アプリがローカルで完璧になった状態で、インフラの構築と同時に、これまで書いたテストを強制する仕組みを作ります。

#### ⬛ ステップ 24: バックエンドのDocker化 ＆ コールドスタート徹底高速化
> 当面のLambda化対象は軽量な入口エンドポイント（`backend`）のみ。`docling-service`/`pdf2htmlex-service`のLambda化は後続で対応する（ADR-017）。
- [x] **AWS Lambda Web Adapter の導入:** 本番用`backend/Dockerfile.lambda`にWeb Adapterのバイナリ（`COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter...`）を追加し、FastAPIをサーバーレス向けに高速起動化（開発用`backend/Dockerfile`とは別ファイル）
- [x] **APIキーのParameter Store取得（グローバルスコープ・キャッシュ）:** `app/secrets_loader.py`を追加し、Lambdaのコールドスタート時（モジュールimport＝グローバルスコープ）に一度だけParameter StoreからAPIキーを取得して`os.environ`へ展開。ハンドラ内で毎リクエストSSMを叩かず、キーはイメージに焼き込まない（ADR-017）
- [x] 🧪 **コンテナ内テスト実行:** Dockerコンテナ内で `pytest` を実行し、環境依存なく高速にテストがパスすることを確認（backend 130件）

#### ⬛ ステップ 25: TerraformによるAWSインフラのコード化
> 本ステップは**コード定義まで**（`terraform validate`・`fmt`まで実施、`terraform apply`＝実AWSリソース作成は未実施）。OIDC・GitHub Actionsからのデプロイ認証はステップ26のCI/CD構築時に定義する。
- [ ] ⚙️ **AWS認証情報の設定:** Terraformの実行やGitHub Actionsからのデプロイに必要なAWSの認証（OIDCなど安全な方式）を初期設定（ステップ26で対応）
- [x] TerraformによるCloudFront + S3、AWS Lambda（メモリは余裕を持たせた4GB〜8GB推奨） + API Gateway、AWS WAF、**ECR Private（Lambdaコンテナは同一リージョンのPrivateからのみ取得可。無料枠500MBの逼迫はライフサイクルで抑制。ADR-017）** をコード定義（`infra/`）。APIキーはSecureStringのSSM Parameter Storeで管理し、Lambdaの実行ロールに`ssm:GetParameters`/`kms:Decrypt`を最小権限で付与。state土台は`infra/bootstrap`（S3+DynamoDB）。`terraform apply`（実AWS作成）は未実施
- [ ] 🧪 **ステージングテスト:** デプロイされたクラウド環境のエンドポイントに対して、ローカルからAPIテストを実行して疎通を確認

#### ⬛ ステップ 26: GitHub ActionsによるCI構築 【自動テスト化】
> 本ステップは**CIワークフローの定義まで**。OIDC設定・Branch Protectionへの反映・CD（実デプロイ）は別ステップ／別途対応とする。
- [x] ⚙️ **GitHub Actions設定:** `.github/workflows/ci.yml` を新設。プルリクエスト（PR）作成時、およびmainブランチへのマージ時に、**「フロントのテスト（Vitest/ESLint/vite build）」「バックのテスト（pytest/ruff）」「docling/pdf2htmlexのテスト（pytest/ruff）」が自動で走るワークフロー**を構築。ローカル開発と同じ`docker-compose.yml`のサービス定義をそのまま使い、ローカル/CIの実行結果が乖離しないようにする（backend/frontendは`--no-deps`で単体起動。backendのテストはDocling/pdf2htmlexクライアントをhttpxモックで検証しており実サービス起動は不要）
- [ ] ⚙️ **GitHub設定変更:** 「自動テスト（CI）が100%成功しなければマージできない」という制限をGitHubのブランチ保護ルールに追加（強制自動テスト化）。CIワークフローが実際にGitHub上で走った実績ができてから設定する
- [ ] ⚙️ **CD構築:** OIDCによるAWS認証・`terraform apply`・AWS（S3 / Lambda）への自動デプロイの仕組みを構築（別途対応）

---

### 🔒 フェーズ 5: 認証・認可とデータ保存の追加
最後に、アカウント登録ユーザー向けの機能をアドオンします。ここでもCIが守ってくれる状態で進めます。

- [x] ⚙️ **ローカル検証環境の準備:** Supabase Local CLI（`supabase start`）でAuth・PostgreSQLをローカルに起動し、クラウド環境を作らずに認証・DBを検証できる状態にする（`docs/supabase-local-cli-setup.md`、ADR-020）

#### ⬛ ステップ 27: Supabase Authによる認証・認可の実装
- [x] フロントにSupabase Auth SDK組み込み。バックにJWT認証ミドルウェアを実装（`@supabase/supabase-js`によるemail/passwordログイン、`app/services/auth.py`によるJWT検証。ADR-018）
- [x] ⚙️ **モデル選択機能のゲート解除（ADR-015）:** `app/main.py`の`GATED_ENGINES`判定を、未ログイン時のみ403を返すよう条件を差し替える（Gemini標準/Claude/OpenAIクライアント自体はステップ23で実装済み）
- [x] 🧪 **テストコード追加:** 有効なトークンがある場合、ない場合でAPIの挙動が変わることを検証するテストを追加（`backend/tests/test_auth.py`・`backend/tests/test_render.py`・`frontend/src/store/authStore.test.ts`等）。GitHub上のCIで自動実行されることを確認

#### ⬛ ステップ 28: Supabase（PostgreSQL）の統合 ＆ 最終クローズ
- [x] ⚙️ **ローカルDB環境の構築:** docker-compose.ymlへ`db`サービス（Postgres）を追加し、手元の開発環境を汚さずにマイグレーションやテストができる環境を整備（ADR-019。Supabase Local CLIではなく素のPostgresコンテナを選択）
- [x] SQLAlchemy経由でのSupabase接続設定と、データ保存ロジックの実装（`app/db.py`・`app/models.py`・`app/services/history.py`、Alembicマイグレーション`backend/migrations/`。`POST /api/render`成功時にログイン中のユーザーの履歴を自動保存し、`GET /api/history`で一覧取得できる）
- [ ] 🧪 **最終結合テスト:** 認証・DB保存・AI生成が絡む全シナリオのテストをPlaywright等で追加（バックエンドのpytest統合テストは追加済み。フロントの保存済み履歴閲覧UI・Playwright E2Eは未実装、残課題）
- [ ] 🚀 **本番デプロイ:** 全テストが自動でパスし、安全にデプロイされることを確認してプロジェクト完了（実Supabaseプロジェクト・AWS本番環境への適用は別途対応）

#### ⬛ ステップ 29: ログイン専用化とセキュリティ強化
- [x] ⚙️ **ローカル検証環境の整備:** Supabase Local CLIを導入し、JWT検証をJWKS/ES256へ対応（`supabase/config.toml`・`app/services/auth.py`。ADR-020、`docs/supabase-local-cli-setup.md`）
- [x] **新規登録の廃止:** 画面から新規登録導線を削除し、GoTrue側も`enable_signup = false`で自己登録を拒否。アカウント発行は`scripts/create_user.sh`（Admin API）に一本化（ADR-021）
- [x] **Googleアカウントでのログイン:** `signInWithOAuth`と`[auth.external.google]`を追加。未登録アカウントは`enable_signup = false`により弾かれる（ADR-021）
- [x] **セッション管理の改善:** PKCEフロー採用、`onAuthStateChange`の購読解除、復元完了までUIを保留して「チラつき」を防止（ADR-021）
- [x] **XSS対策:** プレビューiframeの`sandbox=""`化（同一オリジン実行によるトークン窃取経路を遮断）、セッション保管を`sessionStorage`へ変更、ビルド成果物へCSPを注入（ADR-021）
- [x] **RLS（行レベルセキュリティ）:** 生成履歴をSupabaseのPostgresへ統合し、`auth.uid()`ベースのポリシーを定義。アプリは`authenticator`→`authenticated`ロールで接続する（ADR-021）
- [x] 🧪 **テストコード追加:** `backend/tests/test_db_rls.py`、`frontend/src/store/authStore.test.ts`・`AuthPanel.test.tsx`の更新（新規登録の非提供・Googleログイン・チラつき防止・購読解除）
