# アーキテクチャ決定記録 (ADR)

`adapt-sheet` における主要な技術選定の背景・理由・トレードオフを記録する。各決定は [`planning/brainstorm.md`](../planning/brainstorm.md) の構想を踏まえたもの。

ステータス: `Proposed`（提案中）/ `Accepted`（採用）/ `Superseded`（後継決定により置換）/ `Deprecated`（非推奨）

---

## ADR-001: インフラ・認証をアドオンとして最後に組み込む

- **ステータス**: Accepted
- **コンテキスト**: 帳票生成AI・リアルタイムプレビューというコア体験の完成度が製品価値の中心。インフラや認証を先に固めると、コア機能のイテレーションが遅くなるリスクがある。
- **決定**: フェーズ1〜3でコア機能（ドキュメント整備、バックエンド最小実装、フロントエンド最小実装、AI・PDF機能）をローカル完結で作り込み、フェーズ4でインフラ、フェーズ5で認証・DBを疎結合に追加する。
- **理由**: コア価値の検証を最速で回せる。インフラ・認証は後付けしやすいよう最初から疎結合設計（環境変数・ミドルウェア分離）を意識する。
- **トレードオフ**: 本番相当の負荷・セキュリティ検証が後回しになる。フェーズ4以降で巻き取る前提。

---

## ADR-002: TDD（テスト駆動開発）を全フェーズで徹底する

- **ステータス**: Accepted
- **コンテキスト**: ClaudeCodeとの協働で実装を進めるため、仕様の認識齟齬やリグレッションを防ぐ仕組みが必要。
- **決定**: 実装前に必ずテストコード（Red）を書き、最小実装でパスさせる（Green）というサイクルを徹底する。バックエンドは`pytest`、フロントエンドは`Vitest`＋`React Testing Library`、E2Eは`Playwright`を用いる。
- **理由**: テストが仕様書として機能し、AIとの共同開発でも意図した挙動から逸脱しにくくなる。
- **トレードオフ**: 初期の開発速度はやや落ちるが、後半のリグレッションコストを抑えられる。

---

## ADR-003: Doclingを既存PDF解析エンジンとして採用

- **ステータス**: Accepted
- **コンテキスト**: 既存PDFをベースにHTML/CSSへ変換する機能が必要。PDFのレイアウト・テキストを高精度に抽出できるライブラリが求められる。
- **決定**: `Docling`をPDF解析・変換の中核ライブラリとして採用する。
- **理由**: レイアウト構造を保持した高精度な抽出が可能。
- **トレードオフ**: OS依存のバイナリ・MLモデルを内包するため、ローカル環境構築およびLambdaコンテナ化で追加の検証コストが発生する（[CLAUDE.md](../CLAUDE.md) の環境依存の注意点を参照）。導入初期に単体検証スクリプトで早期に動作確認する運用でリスクを軽減する。

---

## ADR-004: AWS Lambda Web Adapter + モデル事前焼き込みでコールドスタート対策

- **ステータス**: Accepted
- **コンテキスト**: DoclingのMLモデルはサイズが大きく、Lambdaのコールドスタート時に毎回ダウンロードすると起動が大幅に遅延する。またFastAPIをそのままLambda上で動かすには工夫が要る。
- **決定**: Dockerイメージのビルド時に`docling-tools models download`を実行してモデルをコンテナに焼き込み、`AWS Lambda Web Adapter`を導入してFastAPIをサーバーレス向けに高速起動させる。
- **理由**: 起動時のモデルダウンロード通信を撲滅し、コールドスタートを大幅に短縮できる。Lambda Web Adapterにより既存のFastAPIコードをほぼそのままLambda上で動かせ、ローカル・サーバーレス間のコード差分を最小化できる。
- **トレードオフ**: コンテナイメージサイズが増大し、ビルド時間・デプロイ時間が伸びる。Lambdaのメモリ割り当てを4GB〜8GBと余裕を持たせる必要がある。

---

## ADR-005: Terraformによるインフラのコード化（IaC一本化）

- **ステータス**: Accepted
- **コンテキスト**: AWS（CloudFront, S3, Lambda, API Gateway, WAF）とSupabaseプロバイダーなど、複数サービスにまたがるインフラ構成を再現可能かつレビュー可能な形で管理したい。
- **決定**: `Terraform`にインフラ定義を一本化する。手動でのAWSコンソール操作は避け、全てコードで管理する。
- **理由**: 単一のツールでマルチプロバイダー（AWS + Supabase等）を宣言的に管理でき、レビュー・差分確認・再現性の面で優位。GitHub Actionsとの連携もしやすい。
- **トレードオフ**: Terraformの学習コスト、State管理（リモートバックエンド等）の運用設計が必要になる。

---

## ADR-006: 型安全のためのOpenAPIベース型自動生成

- **ステータス**: Accepted
- **コンテキスト**: フロントエンド（TypeScript）とバックエンド（Python/FastAPI）間でAPIのキー名を手書きで一致させると、実装のズレによるバグが発生しやすい。
- **決定**: FastAPIが自動生成する`openapi.json`から、フロントエンド用のTypeScript型定義を自動生成するスクリプトを整備する（[CLAUDE.md](../CLAUDE.md) 参照）。
- **理由**: スキーマの単一の真実源（Single Source of Truth）をバックエンドに置くことで、フロント・バック間の型ズレを構造的に防止できる。
- **トレードオフ**: 型生成のビルドステップが増える。フェーズ5でAPIスキーマが変わるたびに再生成の運用ルールが必要。
- **実装（ステップ5）**: `backend/scripts/export_openapi.py`（サーバー起動なしで`openapi.json`を書き出し）と`openapi-typescript`（`frontend`の`npm run generate-types`）の組み合わせで実現。`openapi-typescript`の`peerDependencies`がTypeScript 6系に未対応のため、`npm install`時は`--force`が必要（エコシステムの追随待ち。将来対応版が出たら通常インストールに戻す）。

---

## ADR-007: AI API呼び出しのモック層を必須化

- **ステータス**: Accepted
- **コンテキスト**: pytest実行やローカル開発のたびに実際のAI API（旧Claude API、ステップ9以降はGemini API）を呼ぶと、コスト・レイテンシ・レート制限の問題が発生する。
- **決定**: プロンプト内容に応じた疑似レスポンスを返すモック層を必ず経由させ、テスト環境・ローカル開発では実APIを叩かない構成にする（[CLAUDE.md](../CLAUDE.md) 参照）。プロバイダーがAnthropicからGeminiに変わっても（ADR-010）、この決定自体はプロバイダー非依存として維持する。
- **理由**: テストの高速化・再現性確保、および開発中のAPIコスト抑制。
- **トレードオフ**: モックと実APIのレスポンス形式に差異が生じるリスクがあるため、バリデーションテストでレスポンス形式の厳格な検証を別途行う。

---

## ADR-008: 認証にAuth0、データベースにSupabaseを採用

- **ステータス**: Accepted
- **コンテキスト**: フェーズ5でアカウント登録ユーザー向けの認証・データ保存機能を追加する必要がある。
- **決定**: 認証・認可には`Auth0`、データベースには`Supabase (PostgreSQL)`を採用する。
- **理由**: Auth0はJWTベースの認可を含むセキュアな認証基盤をマネージドで提供し、自前実装のセキュリティリスクを避けられる。Supabaseはローカル開発用のCLIがあり、クラウド環境を汚さずにマイグレーション・テストが可能（[CLAUDE.md](../CLAUDE.md) のローカルDB注意点を参照）。
- **トレードオフ**: 外部SaaSへの依存が増える。将来的なベンダーロックイン・コスト増のリスクがある。

---

## ADR-009: フロントエンドの状態管理にZustandを採用

- **ステータス**: Accepted
- **コンテキスト**: ステップ4で「左：入力エディタ／右：リアルタイムプレビュー」の2カラム画面を実装するにあたり、HTML/CSS/JSON等の編集内容を複数コンポーネント（将来的には描画ボタンや履歴スライド機能も含む）から参照・更新する必要がある。propsのバケツリレーは、コンポーネント階層が深くなるフェーズ2以降で保守性が下がる。
- **決定**: `Zustand`をグローバル状態管理ライブラリとして採用する（`frontend/src/store/sheetStore.ts`）。
- **理由**: Reduxのようなボイラープレート（Provider/Action定義/Reducer分離）が不要で、`docs/spec.md`が要求する「入力→即時プレビュー反映」という単純な単方向データフローに対して軽量かつ最小構成で実装できる。React Contextと異なり、購読していないコンポーネントの不要な再レンダリングを避けられる点もリアルタイムプレビューの性能面で有利。
- **トレードオフ**: Reduxのような単一のミドルウェア・DevTools標準機構は持たないため、フェーズ3以降で状態が複雑化した場合はミドルウェア（`zustand/middleware`）追加や設計の見直しが必要になる可能性がある。

---

## ADR-010: AI生成プロバイダーをAnthropic ClaudeからGemini APIへ移行

- **ステータス**: Accepted
- **コンテキスト**: ソロ開発段階でAPI利用コストを抑えたい。Anthropicの有料APIに対し、Google AI StudioのGemini APIは無料枠を提供しており、開発初期のイテレーションに適する。
- **決定**: バックエンドのAI生成クライアント（`backend/app/services/ai_client.py`）をGemini API（`google-genai`ライブラリ）へ全面置換する。`AnthropicAIClient`は削除し、`anthropic`パッケージも依存関係から除去する。既存の`AIClient`インターフェース・`MockAIClient`・`validate_render_result`の契約は変更しない。
- **理由**: 無料枠内で本番相当のAI生成フローを検証でき、開発コストをゼロに近づけられる。プロバイダー切り替えのインターフェースがADR-007により既に抽象化されているため、置換の影響範囲を`ai_client.py`内に閉じ込められる。
- **トレードオフ**: 無料枠のレート制限・将来的な有料化リスクがある。Gemini特有のレスポンス形式（SDKの返却オブジェクト構造）に合わせたパースロジックの実装が必要。Anthropic実装を残さず完全置換するため、将来的にAnthropicへ戻す場合は再実装が必要になる。
- **追記（2026-07-08）**: `GeminiAIClient._MODEL`を`gemini-2.0-flash`から`gemini-2.5-flash`に変更した。実APIキーで疎通確認したところ`gemini-2.0-flash`は無料枠クォータが0（`429 RESOURCE_EXHAUSTED`）で呼び出せず、現行の無料枠推奨モデルである`gemini-2.5-flash`に切り替えたところ正常にHTML/CSS/JSONを生成できた。

---

## ADR-011: ローカル開発用の第三のAI経路としてOllama（Llama 3.2 3B）を追加

- **ステータス**: Accepted
- **コンテキスト**: `MockAIClient`は決定論的な固定レスポンスしか返さないため、生成結果のUI上のバリエーション（htmlの構造・文言の変化）を手元で確認できない。一方、`GeminiAIClient`は無料枠とはいえ外部APIであり、レート制限やネットワーク依存がある。pytestの決定論的な既定挙動（ADR-007）は変更したくない。
- **決定**: ローカルで無料・オフラインに動作する`Ollama`＋`llama3.2:3b`モデルを使う`LlamaAIClient`（`backend/app/services/ai_client.py`）を第三の経路として追加する。既存の`AIClient`インターフェース・`MockAIClient`・`validate_render_result`の契約は変更しない。切り替えは`USE_MOCK_AI=false`かつ`AI_PROVIDER=llama`の環境変数で行い、`AI_PROVIDER`未設定時は従来通り`GeminiAIClient`が既定のままとなる（pytestは`USE_MOCK_AI`未設定のため`AI_PROVIDER`の値に関わらず`MockAIClient`が使われる）。
- **理由**: ローカルGPU/CPUで完結するためAPIキー・レート制限・通信コストが発生せず、生成AIのバリエーション確認を何度でも試せる。OllamaのREST API（`/api/generate`、`format=json`）のレスポンス契約はGeminiと同じ`{"html", "css", "json"}`形式にできるため、`parse_gemini_response`をそのまま再利用でき実装コストが小さい。
- **トレードオフ**: Ollama本体・モデル（約2GB）のローカルインストールが開発者ごとに必要になる。3Bモデルは本番の`gemini-2.0-flash`と比べて生成品質が低く、本番挙動の代替検証には使えない（あくまでUIバリエーション確認用）。
- **追記（2026-07-08）**: `LlamaAIClient`のコード自体は維持するが、Docker Compose環境へのOllamaコンテナ導入は廃止し（ADR-013）、ローカル（非Docker）実行のサポート自体も終了した（ADR-014）ため、この開発機のHomebrew版Ollama本体・`llama3.2:3b`モデルはアンインストールした。`AI_PROVIDER=llama`を使う場合は開発者が自前でOllamaを用意する必要がある。

---

## ADR-012: ローカル開発環境のDocker Compose化

- **ステータス**: Accepted
- **コンテキスト**: これまでのローカル開発は、backendがPython venv手動構築（`python -m venv .venv` → `pip install -r requirements.txt`）、frontendが`npm install`という手作業のセットアップを前提としており、開発者ごとの環境差異（特にDoclingのOS依存バイナリ・MLモデル。[CLAUDE.md](../CLAUDE.md) の環境依存の注意点を参照）が起きやすかった。`docker compose up --build`一発でfrontend/backendを再現できる環境を整備したいという要望があった（DEVELOPMENT.md ステップ11）。
- **決定**: `docker-compose.yml`と`backend/Dockerfile`・`frontend/Dockerfile`を新規作成し、frontend（Node 20-alpine + Vite）・backend（Python 3.9-slim + FastAPI + Docling）をコンテナ化した。`./backend:/app`・`./frontend:/app`のバインドマウントと`uvicorn --reload`・`vite --host 0.0.0.0`により、ホスト側のコード編集を即座にコンテナへ反映するホットリロード構成にした。DoclingのOCRエンジンは実行時に利用可能なもの（`OcrAutoOptions`）へ自動選択させる仕組みのため、Linux（コンテナ）上では`requirements.txt`に含まれるクロスプラットフォームな`rapidocr`が自動選択されて動作する（macOS専用のOCR依存については ADR-014 参照）。
- **理由**: venv/npm installの手動セットアップを不要にし、開発者間の環境差異を吸収できる。バインドマウント＋ホットリロードにより、コンテナ化しても既存のローカル開発の快適さ（コード編集の即時反映）を損なわない。
- **トレードオフ**: 初回ビルド時にDocling/torch等の大容量パッケージのダウンロードが発生し、時間がかかる。本Dockerfileはローカル開発専用であり、AWS Lambda Web Adapterやモデル事前焼き込み（フェーズ4 ステップ20、ADR-004）を含む本番用コンテナ化とは別物である。

---

## ADR-013: Docker Compose環境へのOllamaコンテナ導入を廃止

- **ステータス**: Accepted
- **コンテキスト**: ADR-012のDocker Compose化に併せて`ollama/ollama`イメージをコンテナとして追加し、backendの既定AI経路を`USE_MOCK_AI=false`＋`AI_PROVIDER=llama`（ADR-011のLlamaAIClient）に設定して動作確認した。実際に`sample.pdf`をDocling経由でAI生成へ流したところ、Docling抽出後の長いプロンプトに対して`llama3.2:3b`が`{"html", "css", "json"}`の必須キー構成を満たすJSONを安定して返せず、`/api/render`が502で失敗するケースが頻発した（Ollamaの`format: "json"`はJSON構文の妥当性のみ強制し、キー構成までは保証しないため）。
- **決定**: `docker-compose.yml`から`ollama`・`ollama-init`サービスおよび`ollama_data`ボリュームを削除し、backendサービスの既定AI経路を`USE_MOCK_AI=true`（`MockAIClient`）に戻す。
- **理由**: Docker Compose環境の主目的はfrontend/backendの開発環境再現であり、信頼性の低いAI生成経路を既定にする必要性は低い。モックであれば`/api/render`のレスポンス契約（`docs/spec.md` 3.1）を決定論的に確認でき、ADR-012が意図したDocker環境構築の本来の目的を損なわない。
- **トレードオフ**: Docker Compose環境内でOllama経由の生成バリエーションを確認する手段がなくなった。なお、ADR-011で追加した`LlamaAIClient`自体（アプリケーションコード）は本決定の対象外であり、`OLLAMA_BASE_URL`を通じたOllama連携は引き続き利用可能（ただしADR-014によりOllama自体をローカル(非Docker)で用意する手順はドキュメントの対象外とした）。実Gemini APIを使いたい場合は`docker-compose.yml`の`backend.environment`を`USE_MOCK_AI=false`/`AI_PROVIDER=gemini`/`GEMINI_API_KEY`に上書きする。JSON整形の信頼性が今後の技術的関心事として残る場合は、Ollamaの構造化出力（JSON Schemaによる`format`指定）や大きめのモデルへの変更を再検討候補とする。

---

## ADR-014: ローカル環境での直接実行（非Docker）のサポートを終了

- **ステータス**: Accepted
- **コンテキスト**: ADR-012でDocker Compose環境を整備した後も、README.mdにはvenv/npm installによる手動セットアップ手順が併記されており、`backend/Dockerfile`や`frontend/vite.config.ts`にもホスト（非Docker）実行との差異を吸収するための考慮（ホストのPythonバージョンとの整合、`requirements.txt`のmacOS互換維持、Viteプロキシ先のlocalhostフォールバック等）が残っていた。2つの実行方法を並行して記述・維持するコストと、記述間の不整合リスクが見合わないと判断した。
- **決定**: ローカル（非Docker）での直接実行はサポート対象外とし、Docker Compose環境のみを開発環境として位置づける。具体的には以下を実施した。
  - `README.md`から手動セットアップ（venv/npm install）の手順一式を削除し、Docker Composeでの起動方法のみを記載する
  - `backend/requirements.txt`からmacOS専用の`ocrmac`/`pyobjc-framework-*`を削除し、`backend/Dockerfile`のLinux向け除外インストール（grepによるフィルタリング）を撤去して単純な`pip install -r requirements.txt`に戻す
  - `frontend/vite.config.ts`の`/api`プロキシ先を`http://backend:8000`固定にし、`BACKEND_URL`環境変数によるホスト実行時のフォールバックを削除する
  - `CLAUDE.md`のビルド・テストコマンドを`docker compose exec`経由の実行に統一する
- **理由**: 単一の実行環境に一本化することで、ドキュメント・Dockerfile双方の記述量とメンテナンスコストを削減できる。特にDoclingのOS依存バイナリ問題（ADR-003）は、コンテナ内Linuxに統一することで実質的に解消される。
- **トレードオフ**: Docker Desktop（またはOCI互換ランタイム）が利用できない環境では開発できなくなる。将来的にホスト実行の需要が生じた場合は、本ADRを踏まえて改めて手動セットアップ手順を整備する必要がある。
- **既知の課題と解決（追記）**: 当初、フロントエンドのPlaywright（E2E）は`node:20-alpine`ベースイメージがブラウザバイナリ非対応（Alpine/musl libc）のためコンテナ内で実行できない課題があった。frontendの軽量なAlpineイメージ自体は変更せず、代わりにMicrosoft公式のPlaywrightイメージ（`mcr.microsoft.com/playwright`、glibcベースでブラウザ同梱）を使う独立サービス`e2e`（`frontend/Dockerfile.e2e`）を`docker-compose.yml`に追加し、**専用コンテナ方式で解決済み**。`e2e`サービスはfrontendサービスに依存（`depends_on`）し、起動済みのVite開発サーバーへコンテナ間のサービス名（`http://frontend:5173`）で接続する。`playwright.config.ts`は`PLAYWRIGHT_TEST_BASE_URL`が設定されている場合、自身での`webServer`起動をスキップしてこの接続先を使う。常時起動する必要はないため`profiles: [e2e]`でopt-in化し、`docker compose --profile e2e run --rm e2e`で実行する。あわせて、Viteの`allowedHosts`制限（DNSリバインディング対策）によりコンテナ間のHostヘッダー（`frontend`）がデフォルトでは拒否される問題が判明したため、`vite.config.ts`の`server.allowedHosts`に`frontend`を追加して解消した。

---

## ADR-015: Git Worktreeによるmain専用参照ディレクトリ（docs-space）の導入

- **ステータス**: Accepted
- **コンテキスト**: 機能ブランチ（`feat/stepN-*`）で作業中、プライマリの作業ディレクトリ（`/Users/mina/adapt-sheet`）は当該ブランチをチェックアウトしているため、`main`ブランチの最新ドキュメント（`DEVELOPMENT.md`等）を確認するには都度`git stash`やブランチ切り替えが必要になり、作業の中断コストが高かった（DEVELOPMENT.md ステップ12）。
- **決定**: `git worktree add`でプロジェクトの1つ上の階層（`/Users/mina/docs-space`）に`main`ブランチ専用のワークツリーを作成し、プロジェクトルート直下に相対パスのシンボリックリンク（`docs-space -> ../docs-space`）を配置してClaudeCode・エディタから参照できるようにした。セットアップ実行時点でプライマリの作業ディレクトリ自体が`main`をチェックアウト中だったため、通常の`git worktree add`（同一ブランチの複数箇所チェックアウトを禁止する制約）に抵触し失敗した。docs-spaceは常時最新の`main`を閲覧する読み取り専用の用途であり書き込み・コミットは行わない前提のため、`--force`オプションを付与して同一ブランチの重複チェックアウトを許可する形で作成した。
- **理由**: 別ワークツリーとして分離することで、プライマリの作業ディレクトリのブランチ状態を一切変更せずに`main`の最新状態を随時参照できる。シンボリックリンクをgit管理下に置くことで、他の開発者も`git worktree add ../docs-space main`を実行するだけで同じ構成を再現できる。
- **トレードオフ**: `--force`で同一ブランチを重複チェックアウトしているため、プライマリ側で`main`に直接コミットした場合（通常は行わない運用だが）docs-space側は自動追従せず、`docs-space`内で`git pull`等による手動同期が必要になる。`/Users/mina/docs-space`はプロジェクトディレクトリの外（1つ上の階層）に作成されるため、リポジトリ自体をまるごと移動・削除する際は`git worktree remove`での明示的な後始末が必要になる。

---

## ADR-016: 構造化ログ基盤（標準loggingベースのJSONログ＋リクエスト相関ID）

- **ステータス**: Accepted
- **コンテキスト**: DEVELOPMENT.md ステップ13として追加。既存バックエンド（`backend/app/main.py`）はログ出力を一切持たず、`/api/render` のどの段階（JSONバリデーション・Docling変換・AI生成）で失敗したのかをサーバー側で追跡する手段がなかった。今後のバックエンド分離（ステップ15）でプロセス/コンテナが増えると、横断的なログ相関の重要性がさらに増す。
- **決定**: Python標準ライブラリの`logging`をベースに、以下を導入する。新たなログ用サードパーティ依存（structlog等）は追加しない。
  - **JSON構造化ログ**: 1レコード=1行のJSONを標準出力へ出す`logging.Formatter`のサブクラス（`backend/app/logging_config.py`）。`timestamp`/`level`/`logger`/`message`に加え、`request_id`・`method`・`path`・`status_code`・`duration_ms`等の文脈フィールドを含める。コンテナ（ADR-012/014）やLambda（フェーズ4）の標準出力ログ収集と相性が良い。
  - **リクエスト相関ID（request_id）**: リクエストごとにUUIDを採番するASGIミドルウェア（`backend/app/middleware.py`）。`contextvars`でリクエストスコープに保持し、同一リクエスト内の全ログへ自動付与する。レスポンスには`X-Request-ID`ヘッダーとして返し、エラー時はレスポンスボディにも含める（ADR-017）。
  - **アクセスログ**: ミドルウェアで各リクエストの開始・終了（method・path・status・duration_ms）をINFOで記録し、未捕捉例外はERRORでスタックトレース付きで記録する。
  - **機微情報の非出力**: APIキー（`GEMINI_API_KEY`等）・リクエストボディ全文・PDFバイト列はログに出さない。CLAUDE.mdのセキュリティ規約に準拠する。
- **理由**: 標準`logging`のみで構造化ログと相関IDを実現でき、依存を増やさずにコンテナ/サーバーレス環境の標準出力ログ収集に載せられる。相関IDをレスポンスとログの双方に出すことで、ユーザーが画面で見た`request_id`から該当リクエストのログを一意に特定でき、ステップ14のエラー設計と自然に噛み合う。
- **トレードオフ**: `contextvars`ベースの相関IDはASGIミドルウェア層で設定するため、ミドルウェアを通らない経路（起動時処理等）ではrequest_idが付かない。JSONフォーマッタは人が生ログを読む際にはやや冗長だが、ローカルでは`docker compose logs`をjq等で整形して読める。将来ログ量が増えた場合のサンプリング・集約は本ADRの範囲外とする。
- **ステップ番号の対応（リナンバリング注記）**: ステップ13（本ADR）・14（ADR-017）の差し込みに伴い、旧ステップ13〜24はステップ15〜26へ繰り下げた。過去のADR（ADR-004/012等）本文中の「ステップN」表記は当時の歴史的記録としてそのまま残しているため、ステップ番号が13以上の箇所は現行ロードマップでは+2された番号に対応する（例: ADR-012・ADR-013中の「フェーズ4 ステップ20（本番コンテナ化）」＝現行のステップ22）。

---

## ADR-017: API通信の構造化エラーレスポンス設計とフロントエンド表示

- **ステータス**: Accepted
- **コンテキスト**: DEVELOPMENT.md ステップ14として追加。従来のエラー応答は`HTTPException(detail=...)`による文字列（`{"detail": "..."}`）で、`detail`にはバックエンドの生の例外メッセージ（英語・内部情報を含みうる）がそのまま載っていた。フロントエンド（`frontend/src/store/sheetStore.ts`）はHTTPステータスコードから静的な日本語文言（`messageForStatus`）へ丸めるだけで、バックエンドが持つ原因の粒度や、ログと突き合わせるための相関IDを画面へ反映できなかった。「バックエンドで発生したエラーをフロント画面のメッセージとして安全に表示する」ことが求められた。
- **決定**: エラー応答を次の構造化エンベロープに統一する（docs/spec.md 4.1）。
  - 形式: `{"error": {"code": <機械可読識別子>, "message": <ユーザー向け安全文言>, "request_id": <相関ID>}}`
  - `code`は例外種別に1対1対応（`VALIDATION_ERROR`=400 / `PAYLOAD_TOO_LARGE`=413 / `PDF_CONVERSION_ERROR`=422 / `RATE_LIMITED`=429 / `AI_GENERATION_ERROR`=502 / `INTERNAL_ERROR`=500）。
  - `message`はステータス／`code`ごとに固定の安全な日本語文言へ丸め、生の例外メッセージ・スタックトレースはレスポンスに含めずサーバーログ（ADR-016）にのみ残す。
  - `request_id`はADR-016で採番した相関IDで、`X-Request-ID`ヘッダーと同値。
  - 実装は、FastAPIの例外ハンドラ（`app.exception_handler`）で`PDFConversionError`/`AIGenerationError`/`HTTPException`/未捕捉`Exception`を捕捉し、上記エンベロープの`JSONResponse`へ変換する。既存の`main.py`は例外を送出するだけにし、整形はハンドラへ寄せて一貫性を担保する。
  - フロントは`RenderApiError`に`code`/`message`/`request_id`を持たせ、`sheetStore`はバックエンド提供の`message`を優先表示する。ボディが構造化エンベロープでない場合（ネットワーク断・想定外レスポンス）は従来のステータス別既定文言にフォールバックする。
- **理由**: `code`（機械可読）と`message`（人間向け）を分離することで、フロントは表示にも分岐にも使える。安全文言をバックエンドが返す一方で技術詳細はログにのみ残すため、情報漏えいリスクなくユーザーへ状況を伝えられる。`request_id`を画面とログの双方に出すことで問い合わせ・障害調査の突き合わせが可能になる。
- **トレードオフ**: レスポンス形式が`{"detail": ...}`から`{"error": {...}}`へ変わるため、`detail`前提の既存テスト・クライアントは更新が必要（本ステップで併せて更新）。FastAPIの自動生成OpenAPI（openapi.json）にはカスタム例外ハンドラのエラースキーマは反映されないため、エラーボディの契約はopenapi.jsonではなくdocs/spec.md 4.1で維持する。フロントはステータス別の既定文言も引き続き保持し、二重管理になるが、バックエンド不達時の保険として許容する。

---

## ADR-018: バックエンドの「入口エンドポイント」と「Doclingコンテナ」への分離

- **ステータス**: Accepted
- **コンテキスト**: DEVELOPMENT.md ステップ15として追加。従来の`backend`コンテナは、リクエスト受付・バリデーション・AI呼び出しを担うAPIエンドポイントと、Docling（`torch`/`opencv-python`/`transformers`等の大容量ML依存を含む）によるPDF変換処理が同一プロセス・同一コンテナに同居していた。Doclingの依存関係はイメージサイズ・ビルド時間・コンテナ起動時間に大きく影響するため、PDFを伴わないリクエスト（大半のケース）でも常にこの重量級コンテナの起動を待つ必要があり、AWS Lambdaのコールドスタート対策（ADR-004）の方針とも整合しない状態だった。
- **決定**:
  - バックエンドを2つのコンテナ/プロセスに分離する。
    - `backend`（入口エンドポイント）: `/api/render`のリクエスト受付・バリデーション・プロンプト構築・AI呼び出し・エラー整形（ADR-016/017）を担う軽量プロセス。Docling関連の依存を含まない。
    - `docling-service`（Docling変換専用）: PDFバイト列を受け取りHTMLへ変換する処理のみを担うステートレスな内部サービス。Docling本体とその重量級依存はこちらにのみ含める。
  - 通信方式は**HTTP**とする。`docling-service`が内部専用エンドポイント`POST /convert`（multipart、PDFファイル→`{"html": ...}`）を公開し、`backend`はDocker Compose内部ネットワーク経由（サービス名`docling`、環境変数`DOCLING_SERVICE_URL`）でこれを呼び出す。ホストへは公開しない。
  - `backend`側の`PDFConverter`プロトコル（`app/services/docling_client.py`）はインターフェースを変更せず、実装のみをプロセス内呼び出し（`DoclingPDFConverter`）からHTTP呼び出し（`RemoteDoclingPDFConverter`）に差し替える。これにより`app/main.py`のDI配線・`docs/spec.md` 3.1の外部API契約（`/api/render`のリクエスト/レスポンス形式）は無変更のまま分離できる。`docling-service`からの非200応答・接続エラーは、既存の`PDFConversionError`（422、ADR-017）へマッピングする。
- **理由**: gRPCやメッセージキューは本フェーズの要件（単一の同期変換呼び出し）に対して過剰であり、既存スタック（FastAPI/Docker Compose）と最も親和性が高いHTTPを選んだ。`PDFConverter`プロトコルを維持したままDIの実装差し替えのみで分離できるため、既存の`test_render.py`（`dependency_overrides`でフェイクに差し替え済み）がそのまま「分離後もAPI契約が変わらないことを検証するテスト」として機能し、変更不要となる。将来のAWS Lambda分離（ADR-004）でも、エンドポイント間通信をHTTP呼び出しとして踏襲しやすい。
- **トレードオフ**: サービス間通信がネットワーク越しになるため、プロセス内呼び出しにはなかった接続エラー・タイムアウトのハンドリングが新たに必要になる（`PDFConversionError`へのマッピングで対応）。`docling-service`のリクエストログには現時点でADR-016の相関ID（`request_id`）を伝播しておらず、サービス間のログ突き合わせは将来課題として残る。

---

## ADR-019: 帳票生成品質の改善（入力の整理・PDF解析の役割分担・プロンプト設計）

- **ステータス**: Accepted
- **コンテキスト**: ステップ16以降、「PDFと見た目が変わらない、かつ保守しやすいHTML/CSSを生成する」という中核体験の品質を上げる過程で、入力の整理・PDF解析の構成・プロンプト設計・エラー耐性にまたがる調整を重ねた。当初は個別のADR（旧ADR-019〜021・023〜026）として記録していたが、いずれも同一目的の微調整であり、現行の到達点として本ADRへ統合する。試行の経緯はGitログを一次ソースとする。
- **決定**:
  - **入力からCSSを廃止**: `/api/render`のリクエストに`css`フィールドを持たず、CSS入力エディタも設けない（HTML入力／JSON入力／プロンプト入力の3エディタ）。CSSは手書きHTML・PDF変換結果のいずれの経路でも常にHTML側の`<style>`へ埋め込まれるため、別立ての入力は意味のある分離にならない。レスポンス側の`RenderResponse.css`（AI生成スタイルをプレビューへ渡す出力契約）は対象外。
  - **PDF解析を「レイアウト」と「テキスト」へ役割分担し並列実行**: レイアウトHTML（見た目の正）とDoclingのMarkdown（テキストの正）の両方をGeminiへ渡し、プロンプトで役割を明示する。backendは両者を`asyncio.gather`＋`asyncio.to_thread`で並列に取得する（直列だと変換時間が単純加算されるため）。Doclingは`export_to_html`ではなく`export_to_markdown`を返す（`docling-service`の`POST /convert` → `{"markdown": ...}`）。
  - **レイアウトHTMLはPyMuPDFで生成**: backend内の純Pythonモジュール（`backend/app/services/pdf_layout.py`）が、テキストを`text-element`・罫線を`border-element`・塗りを`bg-element`の絶対配置divへ写した1枚のHTMLを返す。当初はpdf2htmlEXの専用コンテナで生成していたが、PyMuPDFへ置き換えて廃止した。
  - **PDFは1ページ目のみ送る**: 帳票は1ページ完結が前提（docs/spec.md 2.1）のため、backend側で1ページ目に切り詰めてから（`app/services/pdf_common.py`の`first_page_only`、`pypdf`）レイアウト生成とDoclingの双方へ渡す。PDFとして解析できない場合は切り詰めず元のバイト列を送り、検証・422化はdocling-service側の既存ハンドリング（ADR-018）へ委ねる。
  - **プロンプトの役割分担（`build_prompt`）**: 「元の視覚的体裁（レイアウト・余白・罫線・フォントサイズ配分）を最優先で維持し、保守性（セマンティックなタグ・意味のあるclass名・整理された`<style>`）だけを作り替える」指示にする。生成JSONは配列・ネストを使わないフラットなスネークケース（例: `item_1_qty`）とする（`frontend/src/lib/template.ts`がトップレベルキーの単純な文字列置換のみに対応するため）。htmlの`{{key}}`とjsonキーを過不足なく一対一に対応させる（空欄セルでも空文字列でキーを含める）ことは絶対厳守ルールとする。
  - **フォントサイズの上限**: レイアウトHTML側（`_capped_font_size`）で元サイズから役割を推定し、タイトル22px・見出し14px・明細/本文/その他11pxで頭打ちにする（上限以下は縮めない）。プロンプト側でも同じ上限と、「見出しタグはブラウザ既定サイズのまま使わず必ず上限内へ上書きする」ことを指示する。実際に見た目を作るのはGeminiのため、プロンプト側が最終的な効き目を持つ。
  - **テンプレート変数の欠けは502にせず補完**: `validate_render_result`は、htmlの`{{key}}`に対応するjsonキーが欠けている場合、空文字列で補完してレンダリングを成立させる。html/cssが空・jsonがオブジェクトでない等の重大な契約違反は従来どおり502で失敗させる。
  - **Gemini呼び出しの堅牢化**: `response_mime_type="application/json"`（コードフェンス・前置きの混入防止）と`max_output_tokens=16384`（長い帳票や思考モデルでJSONが途中で切れるのを防ぐ）を指定する。503（`ServerError`＝Gemini側の混雑）のみ指数バックオフで最大3回再試行し、429（クォータ超過）等のクライアントエラーは再試行しても結果が変わらないため即座に502で失敗させる。
  - **モック帳票を用紙の向きで出し分け**: `MockAIClient`（`backend/app/services/mock_templates.py`）は縦（高さ>=幅）＝納品書、横＝請求書のモックを返す。A4/B5/A5で内容は分岐しない。CSSのフォントサイズ・余白はvw単位にし、`PreviewPanel`が用紙の実寸pxでiframeを組版する仕組みと合わせて、幅の狭いA5でも同じCSSのまま収まるようにする。
  - **描画中の経過秒数表示**: 描画ボタンに`isLoading`がtrueの間だけマウントされる`RenderingProgress`（`frontend/src/App.tsx`）を置き、1秒ごとに「描画中...(N秒)」と表示する。マウント／アンマウントで秒数が自然に0へ戻る設計にし、`useEffect`内の直接的な`setState`（`react-hooks/set-state-in-effect`）を避ける。
- **理由**:
  - Docling（テキストに強く見た目を持たない）とレイアウトHTML（見た目に忠実だが構造が機械的）は弱点が相補的であり、両方を渡せばGeminiが要素ごとにどちらを信じるかを判断できる。
  - レイアウト生成を純Pythonモジュールにすることで、専用コンテナ・x86_64エミュレーション・HTTPホップが不要になり、罫線・塗りを座標付きの図形として直接扱える。
  - 使われない入力経路（CSS）を持たないことで、UIとAPI契約を最小限に保ち、HTML側の`<style>`とCSS入力欄が食い違う不整合リスクも構造的に排除できる。
  - LLMの出力は確率的で完全な保証はできない。1件のキー漏れで帳票全体を502にするより、空欄セルとして描画するほうがUXが良く、値を出さなかったモデルの意図にも忠実である。
- **トレードオフ**:
  - **PyMuPDFのライセンス**: AGPL v3（または商用ライセンス）。本番でSaaSとして提供する場合はAGPLの適用範囲の検討が必要。ユーザーの明示選択のうえで採用した。実装は`pdf_layout.py`に閉じており、必要ならMITの`pdfplumber`等へ差し替えやすい。
  - **見た目の推定の限界**: 太字はフォント名（`bold`/`gothic`等）から、フォントサイズの役割は元サイズの閾値からの推定に留まる。`get_drawings()`は`f`（塗り）と`s`（線）のみ扱い、極小の塗り（1px以下、アンチエイリアス由来）は除外する。細部の欠けはGeminiがMarkdownと突き合わせて補う前提。
  - **モックの向き判定の暗黙的な結合**: `build_prompt`が埋め込む「帳票サイズ: 横Xmm × 縦Ymm」の行を正規表現で読み取るため、この行のフォーマットを変える場合は`MockAIClient`側の追随が必要。`AIClient`プロトコル（`generate(prompt: str)`）を変えずに実現するための選択。
  - **無料枠の制約（運用上の注意）**: `gemini-2.5-flash`の無料枠は1日20リクエストのため、実生成の動作確認を数回繰り返すと429になる。クォータはモデル単位のため、環境変数`GEMINI_MODEL`で別モデルへ切り替えれば別枠で検証を継続できる（既定は`gemini-2.5-flash`）。
  - 将来、HTMLから独立してCSSのみを差し替えたい要件（複数帳票での共通スタイルシート）や、2ページ目以降を使う要件が生じた場合は、本ADRの前提そのものを再検討する。

---

## ADR-022: コードコメントは「なぜ」だけを書き、経緯はADRへ集約する

- **ステータス**: Accepted
- **コンテキスト**: これまでのCLAUDE.md規約は「関数/コンポーネント/設定単位で『なぜそう書いたか』のコメントを必ず添える」という**必須・徹底**の形だった。この規約はコメントの空白地帯を作らない効果があった一方、実装が進むにつれて次の3種類の冗長なコメントを大量に生んだ。
  1. コードを読めば分かることの言い換え（`const [isDragging, setIsDragging] = useState(false)` に対する「ドラッグ中かどうか」等）。
  2. 処理手順（How）の逐語的な説明。コードを変更するとコメントだけが古くなり、嘘をつくコメントになる。
  3. 実装の経緯・過去のユーザーレビュー履歴・ステップ番号（「ステップ18で〜」「その後『1.25倍大きく』との追加レビューを受け20→25に調整」等）。これらは本来ADRとGitログが一次ソースであり、コード中に重複して置くと二重管理になる。

  実測では主要ソースの2〜3割がコメント行であり、コメントがコードの見通しをむしろ悪くしていた。
- **決定**: CLAUDE.md「コード規約」のコードコメント項目を、以下の3原則へ置き換える。
  1. **コードそのものに語らせる**: コードを読めば分かることはコメントにしない。命名・関数分割で意図が伝わるならコメントを足すのではなくコードを直す。
  2. **How を書かない**: 処理手順の説明ではなく、「なぜその選択をしたか（Why）」とコードから読み取れない制約・前提のみを書く。
  3. **経緯は ADR に置く**: 長い背景・検討経緯・レビュー履歴は本ファイル（ADR）に書き、コード側は `（ADR-0XX）` の参照に留める。ステップ番号や変更履歴はコメントに残さない。
- **理由**: コメントは実行されないため、コードと違ってズレても誰も気づかない。コメント量を減らすこと自体が目的ではなく、「コードと同期しないコメント」を構造的に減らすことが目的である。「なぜ」はコードからは決して読み取れないので価値が高く残す一方、「何を・どうやって」はコードが常に正しい一次ソースなので、コメントとして二重に持たない。長い経緯はADRという「更新されなくても古い決定の記録として正しいままである」場所に置くのが適切で、コードコメントとして持つべきではない。
- **トレードオフ**: 「必ず書く」から「読んでも分からないことだけ書く」への変更は判断を書き手に委ねるため、コメントの粒度が担当者ごとに揺れうる。判断に迷った場合は、「このコメントを消したらコードから復元できない情報か？」を基準にし、復元できる情報なら消す。また、コメントを削った結果として意図が読み取りにくいコードが残る場合は、コメントを戻すのではなくリファクタリング（命名変更・関数抽出）で解決する。
- **適用範囲**: 本ADR採用時に、既存の`backend/` `docling-service/` `frontend/`の全ソースへ遡って適用した（同時に、コメントで補われていた重複ロジックを共通化するリファクタリングも実施）。

---

## ADR-027: Git Worktree・ブランチは最小構成（本体＋docs-space・`worktree-*`ブランチを残さない）に保つ

- **ステータス**: Accepted
- **コンテキスト**: バックグラウンドジョブ（Claude Code）は、他ジョブや作業中のチェックアウトと干渉しないよう、ジョブごとに `.claude/worktrees/` 配下へ一時的なGit Worktree（`worktree-<名称>` ブランチ）を自動生成する。隔離自体は妥当だが、掃除の指針が明文化されていなかったため、マージ済み・方針転換で不要になったWorktreeとブランチがローカル・リモートに積み上がった（一時は6 Worktree・多数のブランチが残存）。Worktreeはリポジトリの複製を伴うため、ディスク消費とコンテキスト読み込みの遅延という実害に直結する。
- **決定**: 定常状態のGit構成を次の最小形に保つことをルール化する（詳細な手順は `CLAUDE.md` の「Git / CI運用」に記載）。
  - **Worktreeは2つだけ**: プライマリ本体と、`main` 参照専用の `docs-space`（ADR-015）。`.claude/worktrees/` は定常状態で空にする。
  - **`worktree-*` ブランチを残さない（マージと同時に削除）**: バックグラウンドジョブの一時Worktree／`worktree-*` ブランチは、PRを `main` へマージした**直後にその場で削除する**（セッション終了時まで持ち越さない）。動作中のWorktreeは `ExitWorktree`（`remove`）で離脱・削除、または本体側で `git worktree remove --force` ＋ `git branch -D`、リモートは `git push origin --delete`。
  - **マージ済み・不要ブランチの掃除**: マージ済みブランチ、PRがCLOSEDのまま方針転換で不要になったブランチは、ローカル・リモートとも削除する。リモート削除（`git push --delete`）は事前確認する。
  - **点検手段**: `git worktree list` / `git branch` / `git ls-remote --heads origin` で最小構成を確認する。
- **理由**: Worktree複製の増殖はディスクとコンテキスト読み込みの実害に直結する。ブランチの正は常に `main`（とリモート）にあり、マージ済みの一時ブランチをローカルに残す利益は無い。掃除の基準を明文化することで増殖を未然に防ぐ。
- **トレードオフ**:
  - PRがCLOSED（未マージ）のブランチを削除すると、そのブランチ固有のコミットはローカルから失われる。リモートに同名ブランチが残っていれば復元できるため、リモートも消す場合は本当に不要かを確認する。
  - バックグラウンドジョブは仕組み上ジョブごとにWorktreeを作る。本ルールは「作らない」ではなく「作業（PR）完了後に残さない」である。
- **関連**: ADR-015（`docs-space` ＝ `main` 参照専用Worktree）。

## ADR-028: Geminiの入出力全文ログを`LOG_AI_PAYLOAD`によるオプトインで出す

- **ステータス**: Accepted
- **コンテキスト**: プロンプト改善（ADR-019）を進めるうえで、実際にGeminiへ送った入力（`build_prompt`が組み立てたプロンプト全文。PyMuPDF由来のレイアウトHTMLとDocling由来のMarkdownを含む）と、Geminiが返した出力全文をサーバー側で確認したいという要望が出た。従来のログ（ADR-016）はアクセスログとエラーのみで、AI生成の入出力は一切残らず、生成品質が悪いときに「プロンプトが悪いのか、モデルの出力が悪いのか」を切り分けられなかった。特に`parse_ai_response`がJSONパースに失敗して502になるケースでは、原因である生のレスポンス文字列が失われていた。一方でADR-016は「リクエストボディ全文はログに出さない」と定めており、プロンプトには帳票の業務データ（取引先名・金額等）が含まれるため、無条件の全文ログはこの決定と衝突する。
- **決定**: `backend/app/services/ai_client.py`の`GeminiAIClient.generate`に、環境変数`LOG_AI_PAYLOAD`でオプトインする全文ログを追加する。
  - **出力内容**: API呼び出しの直前にプロンプト全文（`ai_prompt`）を、レスポンス受信直後に出力全文（`ai_response`）を、いずれも`app.ai`ロガーのINFOで1レコードずつ出す。使用モデル（`ai_model`）も併せて出す。既存のJSON構造化ログ（ADR-016）に載せるため、`JsonLogFormatter._CONTEXT_FIELDS`へ`ai_model`/`ai_prompt`/`ai_response`を追加する。`request_id`はcontextvarから自動付与されるため、アクセスログと同一リクエストとして突き合わせられる。
  - **出力タイミング**: レスポンスのログは`parse_ai_response`の前に出す。パース失敗の原因調査こそが主目的であり、例外が送出されても生の出力が残るようにする。
  - **既定は無効**: `LOG_AI_PAYLOAD`未設定時は出力しない（ADR-016の「機微情報の非出力」を既定として維持）。環境変数は呼び出しごとに読み、コンテナを再ビルドせず切り替えられるようにする。
  - **ローカル開発では有効**: `docker-compose.yml`の`backend.environment`に`LOG_AI_PAYLOAD=true`を明記し、開発環境（ADR-014によりDocker Composeのみを対象）では追加設定なしで確認できるようにする。本番（フェーズ4のLambda等）では設定しない限り無効のままとなる。
  - **対象はGemini経路のみ**: `MockAIClient`の出力は固定テンプレート（ADR-019）でログの価値が無く、`LlamaAIClient`はADR-013で既定経路から外れているため、本ADRの対象に含めない。
- **理由**: 全文ログの価値（プロンプト改善・パース失敗の原因究明）と、業務データをログへ残すリスクは、環境によって釣り合いが逆転する。環境変数によるオプトインにすれば、ローカルでは全文を見ながらプロンプトを反復でき、本番既定ではADR-016の非出力方針を崩さずに済む。切り捨て（truncate）ではなく全文を出すのは、レイアウトHTMLの一部が欠けたログではプロンプト改善の判断材料にならないため。ファイル出力等の別経路を設けず既存のJSON構造化ログへ載せるのは、`request_id`による相関と`docker compose logs`＋`jq`での読み取りをそのまま流用できるため。
- **トレードオフ**: 有効時のログ1行は数十KB〜数百KB（レイアウトHTMLを含むプロンプト）に達しうるため、`docker compose logs`をそのまま眺めると読みにくい。`jq -r 'select(.ai_prompt) | .ai_prompt'`のような整形を前提とする。ログ量課金のある集約基盤（CloudWatch等）で有効化する場合はコストに注意が必要で、本番での既定無効はその保険でもある。フラグを有効にした環境ではログに業務データが残るため、ログの取り扱いは当該環境の責任範囲となる。
- **関連**: ADR-016（構造化ログ基盤・機微情報の非出力）、ADR-017（生の例外メッセージはレスポンスに載せずログにのみ残す）、ADR-019（`parse_ai_response`が扱うGeminiレスポンスの契約）。

---

## 今後の追記予定

- フェーズ4・5の実装過程で発生した追加の技術決定（Terraformのstate管理方式、Supabaseのスキーマ設計方針等）を随時ADRとして追記する。
