# アーキテクチャ決定記録 (ADR)

`adapt-sheet` における主要な技術選定の背景・理由・トレードオフを記録する。各決定は [`planning/brainstorm.md`](../planning/brainstorm.md) の構想を踏まえたもの。

ステータス: `Proposed`（提案中）/ `Accepted`（採用）/ `Superseded`（後継決定により置換）/ `Deprecated`（非推奨）

システム構成に影響しない微調整（コメント規約・Worktree運用・ログのオプトイン設定等）はADRとして記録せず、必要な範囲でCLAUDE.mdやコード側の記述に留める。

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

## ADR-004: Terraformによるインフラのコード化（IaC一本化）

- **ステータス**: Accepted
- **コンテキスト**: AWS（CloudFront, S3, Lambda, API Gateway, WAF）とSupabaseプロバイダーなど、複数サービスにまたがるインフラ構成を再現可能かつレビュー可能な形で管理したい。
- **決定**: `Terraform`にインフラ定義を一本化する。手動でのAWSコンソール操作は避け、全てコードで管理する。
- **理由**: 単一のツールでマルチプロバイダー（AWS + Supabase等）を宣言的に管理でき、レビュー・差分確認・再現性の面で優位。GitHub Actionsとの連携もしやすい。
- **トレードオフ**: Terraformの学習コスト、State管理（リモートバックエンド等）の運用設計が必要になる。

---

## ADR-005: 型安全のためのOpenAPIベース型自動生成

- **ステータス**: Accepted
- **コンテキスト**: フロントエンド（TypeScript）とバックエンド（Python/FastAPI）間でAPIのキー名を手書きで一致させると、実装のズレによるバグが発生しやすい。
- **決定**: FastAPIが自動生成する`openapi.json`から、フロントエンド用のTypeScript型定義を自動生成するスクリプトを整備する（[CLAUDE.md](../CLAUDE.md) 参照）。
- **理由**: スキーマの単一の真実源（Single Source of Truth）をバックエンドに置くことで、フロント・バック間の型ズレを構造的に防止できる。
- **トレードオフ**: 型生成のビルドステップが増える。フェーズ5でAPIスキーマが変わるたびに再生成の運用ルールが必要。
- **実装（ステップ5）**: `backend/scripts/export_openapi.py`（サーバー起動なしで`openapi.json`を書き出し）と`openapi-typescript`（`frontend`の`npm run generate-types`）の組み合わせで実現。`openapi-typescript`の`peerDependencies`がTypeScript 6系に未対応のため、`npm install`時は`--force`が必要（エコシステムの追随待ち。将来対応版が出たら通常インストールに戻す）。

---

## ADR-006: AI API呼び出しのモック層を必須化

- **ステータス**: Accepted
- **コンテキスト**: pytest実行やローカル開発のたびに実際のAI API（旧Claude API、ステップ9以降はGemini API）を呼ぶと、コスト・レイテンシ・レート制限の問題が発生する。
- **決定**: プロンプト内容に応じた疑似レスポンスを返すモック層を必ず経由させ、テスト環境・ローカル開発では実APIを叩かない構成にする（[CLAUDE.md](../CLAUDE.md) 参照）。AI生成プロバイダーが変わっても、この決定自体はプロバイダー非依存として維持する。
- **理由**: テストの高速化・再現性確保、および開発中のAPIコスト抑制。
- **トレードオフ**: モックと実APIのレスポンス形式に差異が生じるリスクがあるため、バリデーションテストでレスポンス形式の厳格な検証を別途行う。

---

## ADR-007: 認証・データベースにSupabaseを採用

- **ステータス**: Accepted
- **コンテキスト**: フェーズ5でアカウント登録ユーザー向けの認証・データ保存機能を追加する必要がある。
- **決定**: 認証（Supabase Auth）とデータベース（PostgreSQL）を単一の`Supabase`へ統一する。
- **理由**: 単一ベンダーで認証・DBを賄えるため連携コストが小さい。ローカル開発用の`Supabase Local CLI`があり、クラウド環境を汚さずにマイグレーション・テストが可能（[CLAUDE.md](../CLAUDE.md) のローカルDB注意点を参照）。
- **トレードオフ**: 外部SaaSへの依存が増える。将来的なベンダーロックイン・コスト増のリスクがある。

---

## ADR-008: フロントエンドの状態管理にZustandを採用

- **ステータス**: Accepted
- **コンテキスト**: ステップ4で「左：入力エディタ／右：リアルタイムプレビュー」の2カラム画面を実装するにあたり、HTML/CSS/JSON等の編集内容を複数コンポーネント（将来的には描画ボタンや履歴スライド機能も含む）から参照・更新する必要がある。propsのバケツリレーは、コンポーネント階層が深くなるフェーズ2以降で保守性が下がる。
- **決定**: `Zustand`をグローバル状態管理ライブラリとして採用する（`frontend/src/store/sheetStore.ts`）。
- **理由**: Reduxのようなボイラープレート（Provider/Action定義/Reducer分離）が不要で、`docs/spec.md`が要求する「入力→即時プレビュー反映」という単純な単方向データフローに対して軽量かつ最小構成で実装できる。React Contextと異なり、購読していないコンポーネントの不要な再レンダリングを避けられる点もリアルタイムプレビューの性能面で有利。
- **トレードオフ**: Reduxのような単一のミドルウェア・DevTools標準機構は持たないため、フェーズ3以降で状態が複雑化した場合はミドルウェア（`zustand/middleware`）追加や設計の見直しが必要になる可能性がある。

---

## ADR-009: ローカル開発環境のDocker Compose化（非Docker実行はサポートしない）

- **ステータス**: Accepted
- **コンテキスト**: venv/npm installによる手動セットアップは、開発者ごとの環境差異（特にDoclingのOS依存バイナリ・MLモデル。[CLAUDE.md](../CLAUDE.md) の環境依存の注意点を参照）を招きやすい。Docker/非Dockerの2つの実行方法を並行して記述・維持するコストと、記述間の不整合リスクも見合わない。
- **決定**: `docker-compose.yml`と各`Dockerfile`でfrontend（Node 20-alpine + Vite）・backend（Python 3.9-slim + FastAPI）をコンテナ化し、`docker compose up --build`のみをサポート対象とする。バインドマウント＋`--reload`/`--host 0.0.0.0`でホットリロードを維持する。非Docker実行の手順、macOS専用OCR依存（`ocrmac`等）、ホスト実行向けのプロキシフォールバックは持たない。E2E（Playwright）はfrontendの`node:20-alpine`イメージがブラウザバイナリに非対応（Alpine/musl libc）のため、Microsoft公式Playwrightイメージを使う独立サービス`e2e`（`profiles: [e2e]`でopt-in）で実行する。
- **理由**: 単一の実行環境に一本化することで環境差異とドキュメント・Dockerfileの記述コストを削減できる。特にDoclingのOS依存バイナリ問題（ADR-003）は、コンテナ内Linuxに統一することで実質的に解消される。
- **トレードオフ**: Docker Desktop（またはOCI互換ランタイム）が無いと開発できない。初回ビルド時はDocling/torch等の大容量パッケージのダウンロードで時間がかかる。本Dockerfileはローカル開発専用であり、AWS Lambda Web Adapterを含む本番用コンテナ化（ADR-017）とは別物である。

---

## ADR-010: Git Worktreeによるmain専用参照ディレクトリ（docs-space）の導入

- **ステータス**: Accepted
- **コンテキスト**: 機能ブランチ（`feat/stepN-*`）で作業中、プライマリの作業ディレクトリ（`/Users/mina/adapt-sheet`）は当該ブランチをチェックアウトしているため、`main`ブランチの最新ドキュメント（`DEVELOPMENT.md`等）を確認するには都度`git stash`やブランチ切り替えが必要になり、作業の中断コストが高かった（DEVELOPMENT.md ステップ12）。
- **決定**: `git worktree add`でプロジェクトの1つ上の階層（`/Users/mina/docs-space`）に`main`ブランチ専用のワークツリーを作成し、プロジェクトルート直下に相対パスのシンボリックリンク（`docs-space -> ../docs-space`）を配置してClaudeCode・エディタから参照できるようにした。セットアップ実行時点でプライマリの作業ディレクトリ自体が`main`をチェックアウト中だったため、通常の`git worktree add`（同一ブランチの複数箇所チェックアウトを禁止する制約）に抵触し失敗した。docs-spaceは常時最新の`main`を閲覧する読み取り専用の用途であり書き込み・コミットは行わない前提のため、`--force`オプションを付与して同一ブランチの重複チェックアウトを許可する形で作成した。
- **理由**: 別ワークツリーとして分離することで、プライマリの作業ディレクトリのブランチ状態を一切変更せずに`main`の最新状態を随時参照できる。シンボリックリンクをgit管理下に置くことで、他の開発者も`git worktree add ../docs-space main`を実行するだけで同じ構成を再現できる。
- **トレードオフ**: `--force`で同一ブランチを重複チェックアウトしているため、プライマリ側で`main`に直接コミットした場合（通常は行わない運用だが）docs-space側は自動追従せず、`docs-space`内で`git pull`等による手動同期が必要になる。`/Users/mina/docs-space`はプロジェクトディレクトリの外（1つ上の階層）に作成されるため、リポジトリ自体をまるごと移動・削除する際は`git worktree remove`での明示的な後始末が必要になる。

---

## ADR-011: 構造化ログ基盤（標準loggingベースのJSONログ＋リクエスト相関ID）

- **ステータス**: Accepted
- **コンテキスト**: DEVELOPMENT.md ステップ13として追加。既存バックエンド（`backend/app/main.py`）はログ出力を一切持たず、`/api/render` のどの段階（JSONバリデーション・Docling変換・AI生成）で失敗したのかをサーバー側で追跡する手段がなかった。今後のバックエンド分離（ステップ15）でプロセス/コンテナが増えると、横断的なログ相関の重要性がさらに増す。
- **決定**: Python標準ライブラリの`logging`をベースに、以下を導入する。新たなログ用サードパーティ依存（structlog等）は追加しない。
  - **JSON構造化ログ**: 1レコード=1行のJSONを標準出力へ出す`logging.Formatter`のサブクラス（`backend/app/logging_config.py`）。`timestamp`/`level`/`logger`/`message`に加え、`request_id`・`method`・`path`・`status_code`・`duration_ms`等の文脈フィールドを含める。コンテナやLambda（フェーズ4）の標準出力ログ収集と相性が良い。
  - **リクエスト相関ID（request_id）**: リクエストごとにUUIDを採番するASGIミドルウェア（`backend/app/middleware.py`）。`contextvars`でリクエストスコープに保持し、同一リクエスト内の全ログへ自動付与する。レスポンスには`X-Request-ID`ヘッダーとして返し、エラー時はレスポンスボディにも含める（ADR-012）。
  - **アクセスログ**: ミドルウェアで各リクエストの開始・終了（method・path・status・duration_ms）をINFOで記録し、未捕捉例外はERRORでスタックトレース付きで記録する。
  - **機微情報の非出力**: APIキー・リクエストボディ全文・PDFバイト列はログに出さない。CLAUDE.mdのセキュリティ規約に準拠する。
- **理由**: 標準`logging`のみで構造化ログと相関IDを実現でき、依存を増やさずにコンテナ/サーバーレス環境の標準出力ログ収集に載せられる。相関IDをレスポンスとログの双方に出すことで、ユーザーが画面で見た`request_id`から該当リクエストのログを一意に特定できる。
- **トレードオフ**: `contextvars`ベースの相関IDはASGIミドルウェア層で設定するため、ミドルウェアを通らない経路（起動時処理等）ではrequest_idが付かない。将来ログ量が増えた場合のサンプリング・集約は本ADRの範囲外とする。

---

## ADR-012: API通信の構造化エラーレスポンス設計とフロントエンド表示

- **ステータス**: Accepted
- **コンテキスト**: DEVELOPMENT.md ステップ14として追加。従来のエラー応答は`HTTPException(detail=...)`による文字列（`{"detail": "..."}`）で、`detail`にはバックエンドの生の例外メッセージ（英語・内部情報を含みうる）がそのまま載っていた。フロントエンドはHTTPステータスコードから静的な日本語文言へ丸めるだけで、バックエンドが持つ原因の粒度や、ログと突き合わせるための相関IDを画面へ反映できなかった。
- **決定**: エラー応答を次の構造化エンベロープに統一する（docs/spec.md 4.1）。
  - 形式: `{"error": {"code": <機械可読識別子>, "message": <ユーザー向け安全文言>, "request_id": <相関ID>}}`
  - `code`は例外種別に1対1対応（`VALIDATION_ERROR`=400 / `PAYLOAD_TOO_LARGE`=413 / `PDF_CONVERSION_ERROR`=422 / `RATE_LIMITED`=429 / `AI_GENERATION_ERROR`=502 / `INTERNAL_ERROR`=500）。
  - `message`はステータス／`code`ごとに固定の安全な日本語文言へ丸め、生の例外メッセージ・スタックトレースはレスポンスに含めずサーバーログ（ADR-011）にのみ残す。
  - `request_id`はADR-011で採番した相関IDで、`X-Request-ID`ヘッダーと同値。
  - 実装は、FastAPIの例外ハンドラ（`app.exception_handler`）で`PDFConversionError`/`AIGenerationError`/`HTTPException`/未捕捉`Exception`を捕捉し、上記エンベロープの`JSONResponse`へ変換する。
  - フロントは`RenderApiError`に`code`/`message`/`request_id`を持たせ、`sheetStore`はバックエンド提供の`message`を優先表示する。ボディが構造化エンベロープでない場合はステータス別の既定文言にフォールバックする。
- **理由**: `code`（機械可読）と`message`（人間向け）を分離することで、フロントは表示にも分岐にも使える。安全文言をバックエンドが返す一方で技術詳細はログにのみ残すため、情報漏えいリスクなくユーザーへ状況を伝えられる。
- **トレードオフ**: レスポンス形式が`{"detail": ...}`から`{"error": {...}}`へ変わるため、`detail`前提の既存テスト・クライアントは更新が必要。FastAPIの自動生成OpenAPIにはカスタム例外ハンドラのエラースキーマは反映されないため、エラーボディの契約はopenapi.jsonではなくdocs/spec.md 4.1で維持する。

---

## ADR-013: バックエンドの「入口エンドポイント」と「Doclingコンテナ」への分離

- **ステータス**: Accepted
- **コンテキスト**: DEVELOPMENT.md ステップ15として追加。従来の`backend`コンテナは、リクエスト受付・バリデーション・AI呼び出しを担うAPIエンドポイントと、Docling（`torch`/`opencv-python`/`transformers`等の大容量ML依存を含む）によるPDF変換処理が同一プロセス・同一コンテナに同居していた。Doclingの依存関係はイメージサイズ・ビルド時間・コンテナ起動時間に大きく影響するため、PDFを伴わないリクエストでも常にこの重量級コンテナの起動を待つ必要があり、AWS Lambdaのコールドスタート対策（ADR-017）の方針とも整合しない状態だった。
- **決定**:
  - バックエンドを2つのコンテナ/プロセスに分離する。
    - `backend`（入口エンドポイント）: `/api/render`のリクエスト受付・バリデーション・プロンプト構築・AI呼び出し・エラー整形（ADR-011/013）を担う軽量プロセス。Docling関連の依存を含まない。
    - `docling-service`（Docling変換専用）: PDFバイト列を受け取りテキストへ変換する処理のみを担うステートレスな内部サービス。Docling本体とその重量級依存はこちらにのみ含める。
  - 通信方式は**HTTP**とする。`docling-service`が内部専用エンドポイント`POST /convert`（multipart）を公開し、`backend`はDocker Compose内部ネットワーク経由（サービス名`docling`、環境変数`DOCLING_SERVICE_URL`）でこれを呼び出す。ホストへは公開しない。
  - `backend`側の`PDFConverter`プロトコル（`app/services/docling_client.py`）はインターフェースを変更せず、実装のみをプロセス内呼び出しからHTTP呼び出し（`RemoteDoclingPDFConverter`）に差し替える。`docling-service`からの非200応答・接続エラーは既存の`PDFConversionError`（422、ADR-012）へマッピングする。
- **理由**: gRPCやメッセージキューは本フェーズの要件（単一の同期変換呼び出し）に対して過剰であり、既存スタック（FastAPI/Docker Compose）と最も親和性が高いHTTPを選んだ。`PDFConverter`プロトコルを維持したままDIの実装差し替えのみで分離できるため、既存テストが「分離後もAPI契約が変わらないことを検証するテスト」としてそのまま機能する。
- **トレードオフ**: サービス間通信がネットワーク越しになるため、プロセス内呼び出しにはなかった接続エラー・タイムアウトのハンドリングが新たに必要になる。`docling-service`のリクエストログには現時点でADR-011の相関ID（`request_id`）を伝播しておらず、サービス間のログ突き合わせは将来課題として残る。

---

## ADR-014: 帳票生成品質の改善(PDF解析の役割分担・プロンプト設計・堅牢化)

- **ステータス**: Accepted
- **コンテキスト**: 「PDFと見た目が変わらず、かつ保守しやすいHTML/CSSを生成する」という中核体験の品質を上げるため、入力・PDF解析の構成・プロンプト設計・エラー耐性にまたがる調整を重ねた。個別の微調整をADRとして都度残さず、到達点のみ本ADRに記録する。試行の経緯はGitログを一次ソースとする。
- **決定**:
  - **入力からCSSを廃止**: HTML/JSON/プロンプトの3エディタのみとし、CSSは常にHTML側の`<style>`に埋め込む（独立入力は持たない）。
  - **PDF解析を役割分担・並列実行**: レイアウトHTML（backend内`pdf_layout.py`、PyMuPDFによる見た目の正）とDoclingのMarkdown（テキストの正）を`asyncio.gather`で並列取得し、両方をGeminiへ渡す。PDFは1ページ目のみ送る（帳票は1ページ完結が前提）。
  - **プロンプト設計**: 元の視覚的体裁（レイアウト・余白・罫線・フォントサイズ配分）の維持を最優先とし、保守性（セマンティックなタグ・意味のあるclass名・整理された`<style>`）のみ作り替えさせる。生成JSONはネストしないフラットなスネークケースとし、htmlの`{{key}}`と過不足なく一対一対応させる。フォントサイズはレイアウトHTML側・プロンプト側の双方で役割別の上限（タイトル22px/見出し14px/本文11px）を設ける。
  - **テンプレート変数の欠けは502にせず補完**: htmlの`{{key}}`に対応するjsonキーが欠けている場合は空文字列で補完する。html/css空・json型不正等の重大な契約違反のみ502で失敗させる。
  - **Gemini呼び出しの堅牢化**: `response_mime_type="application/json"`・`max_output_tokens=16384`を指定し、思考は無効化する（`thinking_budget=0`）。Gemini 2.5系は思考トークンも出力予算を消費するため、既定の動的思考のままだとJSON本体が途中で打ち切られ502になる事象があった。503（Gemini側の混雑）のみ指数バックオフで再試行し、429等は即座に502で失敗させる。`finish_reason=MAX_TOKENS`の場合は原因が分かる`AIGenerationError`を送出する。
  - **モック帳票**: `MockAIClient`は用紙の向き（縦=納品書/横=請求書）でモックを出し分ける。CSSはvw単位とし、A4/B5/A5いずれでも同一HTML/CSSのまま収まるようにする。
  - **描画中の経過秒数表示**: 描画ボタンに`isLoading`の間だけマウントされる`RenderingProgress`を置き、1秒ごとに経過秒数を表示する。
- **理由**: DoclingとレイアウトHTMLは弱点が相補的であり、両方渡すことでGeminiが要素ごとにどちらを信じるかを判断できる。LLMの出力は確率的で完全な保証はできないため、1件のキー漏れで帳票全体を502にするより空欄セルとして描画するほうがUXが良い。
- **トレードオフ**: レイアウト生成に使う`PyMuPDF`はAGPL v3（または商用ライセンス）。実装は`pdf_layout.py`に閉じており、必要ならMITの代替ライブラリへ差し替えやすい。太字・フォントサイズの役割推定はフォント名・閾値によるヒューリスティックであり限界がある。`gemini-2.5-flash`の無料枠は1日20リクエストのため、動作確認を繰り返すと429になる（環境変数`GEMINI_MODEL`で別モデルへ切り替え可能）。

---

## ADR-015: モデル選択機能の追加（生成AI4種＋変換エンジン3種）とPDF直接送信方式への転換

- **ステータス**: Accepted
- **コンテキスト**: 描画ボタンの隣で生成エンジンを選べるようにしたいという要望を受け、生成AI（Gemini無料/Gemini標準/Claude/OpenAI）とAIを介さない変換エンジン（Docling/pdf2htmlEX/PyMuPDF）の計7エンジンを選択できるようにした。あわせて、生成AIへのリクエストからHTML/JSON/Doclingテキストを排し、PDFをマルチモーダル入力として直接渡す方式へ転換した。ADR-014が確立した「レイアウトHTML＋Docling Markdownを両方AIへ渡す」設計は、この転換により一部が置き換えられた。
- **決定**:
  - `RenderEngine`（7値）と、標準プラン（`gemini`/`claude`/`openai`）を示す`GATED_ENGINES`を定義する。標準プランはフェーズ5（Supabase Auth導入）までは`app/main.py`が403 `FREE_ACCESS_FORBIDDEN`で弾く。
  - `AIClient.generate(prompt, pdf)`にシグネチャを変更し、Gemini/Claude/OpenAIはいずれもPDFバイト列をマルチモーダル入力として直接添付する。`build_prompt`からhtml/markdown引数を削除し`has_pdf`フラグへ置き換える。
  - `ClaudeAIClient`・`OpenAIAIClient`を新設し、既存の`parse_ai_response`・`validate_render_result`をそのまま再利用する。Geminiは無料枠と標準プランでモデルを分ける（`GEMINI_MODEL`/`GEMINI_STANDARD_MODEL`）。
  - Doclingの出力をMarkdownからHTML（`export_to_html`）へ変更し、単独の変換エンジン（`engine=docling`）として公開する。pdf2htmlEXを専用コンテナ`pdf2htmlex-service`として復活させ、同じく単独の変換エンジン（`engine=pdf2htmlex`）とする。既存のPyMuPDFレイアウト生成も単独の変換エンジン（`engine=pymupdf`）として公開する。変換エンジンはAIを介さず、変換結果をそのまま描画結果として返す。
  - フロントに`EngineSelect`を新設し、描画ボタンの隣で7エンジンを選べるようにする。ゲート対象にはロックアイコンを表示するが選択自体は無効化せず、実際の403判定はバックエンドに委ねる。
- **理由**: PDFを直接AIへ渡すマルチモーダル入力は、機械的な中間表現より情報の欠落が少ない。変換エンジンを独立した選択肢として公開することで、AIによる整形と機械的な変換結果を直接比較できる。ゲート判定をバックエンドの1箇所に集約することで、フェーズ5では条件の差し替えのみで済む。
- **トレードオフ**: `pdf2htmlex-service`のベースイメージはx86_64タグのみで、arm64ホストでは常にQEMUエミュレーションになる（将来的にネイティブビルドの検討が必要）。pdf2htmlEXのライセンスはAGPL（PyMuPDFと同様）。OpenAI/Geminiの既定モデル名は実装時点の想定であり、`OPENAI_MODEL`/`GEMINI_STANDARD_MODEL`で随時上書きする前提。
- **関連**: ADR-012（構造化エラー）、ADR-013（docling-service分離）、ADR-014（本ADRが一部を置き換える帳票生成品質の改善）。

---

## ADR-016: 開発用Dockerイメージからのbuild-essential除去（イメージ軽量化）

- **ステータス**: Accepted
- **コンテキスト**: フェーズ4（インフラ構築・コールドスタート高速化）に入る前に、開発用Compose構成のDockerイメージを計測したところ、`backend`が939MB、`docling`が2.81GBだった。両イメージとも`build-essential`（gcc/g++/cpp/binutils等）をaptで導入していたが、コメント上の理由は「manylinuxホイールが無い一部依存のソースビルドに備えた予防的措置」であり、実際にソースビルドが発生している依存は存在しなかった（`requirements.txt`の全依存がaarch64/manylinuxのバイナリwheelで導入できる）。
- **決定**:
  - `backend/Dockerfile`・`docling-service/Dockerfile`の`apt-get install`から`build-essential`を除去する。`docling`側の`libgl1`/`libglib2.0-0`/`libgomp1`（opencv-python/torchが実行時に要求する共有ライブラリ）と、両者の`curl`は引き続き残す。
  - dev deps（`pytest`/`ruff`）は`docker compose exec ... pytest`等のテストコマンド（CLAUDE.md参照）で使うため、開発用イメージには意図的に同梱したままとする。
- **理由**: 予防的に含めていた約280MBのツールチェーンが実際には使われておらず、除去してもビルド（wheel導入のみ）・実行（実PDF変換の結合テストを含むpytest全通過）に影響がないことを実測で確認した。イメージ縮小はビルド・pull・Lambdaのコールドスタートいずれにも寄与する。
- **トレードオフ**: 将来`requirements.txt`にwheel未提供の依存を追加した場合、pip installがソースビルドに失敗する。その際は当該Dockerfileに`build-essential`を再追加する（マルチステージ化でビルド専用ステージに閉じ込める案はフェーズ4のLambda向け本番イメージ設計時に検討する）。
- **実測**: `backend` 939MB → 494MB、`docling` 2.81GB → 2.36GB（合計約900MB削減）。
- **関連**: ADR-009（Docker Compose化）、ADR-013（docling-service分離）。フェーズ4ステップ24（コールドスタート高速化）の前段整備。

---

## ADR-017: Lambda本番イメージ設計（Web Adapter・Parameter Storeのグローバル取得・ECR Private）

- **ステータス**: Accepted
- **コンテキスト**: フェーズ4ステップ24として、軽量な入口エンドポイント（`backend`）をAWS Lambda（コンテナイメージ）へ載せる本番イメージを設計する。決めるべきは、(1) FastAPIをLambda上で動かす方式、(2) 生成AIのAPIキーをLambda上で安全かつ低コストに供給する方式、(3) コンテナイメージの置き場（レジストリ）である。
- **決定**:
  - **AWS Lambda Web Adapter**を採用する。本番用は開発用`backend/Dockerfile`とは別の`backend/Dockerfile.lambda`とし、`COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:...`でLambda拡張バイナリを取り込み、既存のFastAPIコードを改変せず`uvicorn`を`--reload`無しで起動する。
  - **APIキーはParameter Store（SecureString）から実行時取得し、イメージにもコードにも焼き込まない**。取得は`app/secrets_loader.py`が担い、**Lambdaのコールドスタート時（モジュールimport＝グローバルスコープ）に一度だけ**SSM `GetParameters`を呼び、値を`os.environ`へ展開する。ハンドラ内で毎リクエストSSMを叩くことは、Lambdaの実行時間課金の増加とSSMのレートリミット抵触の原因になるため禁止する。冪等性は「既に`os.environ`にあるキーは取得対象から外す」ことで担保し、`SSM_PARAMETER_PREFIX`未設定のローカル/pytestでは何もしない（boto3・AWS認証情報を開発の必須依存にしない）。
  - **コンテナイメージはECR Private（`<account>.dkr.ecr.<region>.amazonaws.com`）へpushする**。Lambdaのコンテナイメージは同一アカウント・同一リージョンのECR Privateからのみ取得でき、ECR Publicはイメージソースとしてサポートされないため（当初ステップ24ではECR Publicとしていたが、ステップ25のTerraform設計時にこの制約が判明し訂正した）。ストレージ無料枠500MBの逼迫は、ライフサイクルポリシー（最新数世代のみ保持）で抑える（超過コストは`backend`イメージ約500MBでも月$0.01未満と軽微）。
- **理由**: Lambda Web Adapterによりローカル・サーバーレス間のコード差分を最小化できる。キーをグローバルスコープで一度だけ取得してメモリ保持することで、実行コスト・レート制限・秘密情報のイメージ非混入を同時に満たす。ECR PrivateはLambdaコンテナの前提であり、ライフサイクルで容量も抑えられる。
- **トレードオフ**: APIキーのローテーションはコールドスタート単位でしか反映されない（更新後はLambda実行環境の入れ替えが必要）。`docling-service`/`pdf2htmlex-service`のLambda化は本ステップの対象外とし、後続で対応する（`backend`のみを先行してLambda化する）。
- **関連**: ADR-013（docling-service分離）、ADR-011（機微情報の非ログ出力）、ADR-016（イメージ軽量化）。

---

## 今後の追記予定

- フェーズ4・5の実装過程で発生した追加の技術決定（Terraformのstate管理方式、Supabaseのスキーマ設計方針等）を随時ADRとして追記する。
