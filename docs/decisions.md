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

## ADR-018: Supabase AuthのJWT検証方式とゲート解除（DEVELOPMENT.md ステップ27）

- **ステータス**: Accepted
- **コンテキスト**: フェーズ5の最初のステップとして、標準プランの生成AI（Gemini標準/Claude/OpenAI、`GATED_ENGINES`）を「未ログイン時のみ403」に切り替える。バックエンド（入口エンドポイント）はSupabase SDKを持たないため、フロントが保持するSupabaseセッションのアクセストークン（JWT）を、バックエンド側で自前検証する方式を選ぶ必要がある。
- **決定**:
  - フロントは`@supabase/supabase-js`でemail/passwordのログイン・新規登録・ログアウトを扱う（`frontend/src/lib/supabaseClient.ts`・`frontend/src/store/authStore.ts`・`frontend/src/components/AuthPanel.tsx`）。`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`未設定時は`supabase`をnullにし、`AuthPanel`自体を非表示にする（Supabaseプロジェクト未作成のローカル開発を壊さないため）。
  - `renderSheet`（`frontend/src/lib/api.ts`）はログイン中のみ`session.access_token`をAuthorizationヘッダー（`Bearer <token>`）として付与する（`sheetStore.fetchRender`が仲介）。
  - バックエンドは`app/services/auth.py`の`get_current_user`が、AuthorizationヘッダーのJWTを**PyJWTでHS256・共有シークレット（`SUPABASE_JWT_SECRET`環境変数）検証**する。Supabase SDK・JWKSへのネットワーク呼び出しは行わず、`aud: "authenticated"`と有効期限も合わせて検証する。検証失敗（ヘッダー無し・シークレット未設定・署名不正・期限切れ・audience不一致）は例外を送出せず**常にNoneを返す（fail-closed）**。
  - `app/main.py`の`/api/render`は、`current_user`（`get_current_user`のDepends）がNoneの場合のみ`GATED_ENGINES`を403にする（ADR-015時点の「常に403」から差し替え）。
- **理由**: HS256共有シークレット方式は、SupabaseプロジェクトのJWT Secret（ダッシュボードで確認可能）を環境変数として渡すだけで完結し、バックエンドにSupabase SDKや外部ネットワーク呼び出し（JWKS取得等）を追加せずに済む。`SUPABASE_JWT_SECRET`未設定時に必ずNoneを返すfail-closed設計により、設定漏れのままゲートが意図せず解禁される事故を防ぐ。PyJWTは純Pythonで導入でき、ADR-016の「軽量イメージ」方針とも整合する。
- **トレードオフ**: Supabaseが将来的に非対称鍵（JWKS/ES256）への移行を必須化した場合、`SUPABASE_JWT_SECRET`方式は使えなくなり検証方式の変更が必要になる（2026年時点ではHS256共有シークレットも提供されている）。フロントのログインUIはemail/passwordのみで、OAuth・マジックリンクは対象外（実際のSupabaseプロジェクト作成・本番運用はステップ28で行う）。
- **関連**: ADR-007（認証・DBにSupabase採用）、ADR-011（機微情報の非ログ出力）、ADR-012（構造化エラー）、ADR-015（`GATED_ENGINES`の新設）。

---

## ADR-019: 生成履歴の永続化方式（DEVELOPMENT.md ステップ28）

- **ステータス**: Accepted
- **コンテキスト**: ステップ28として、登録ユーザーの生成履歴をSupabase（PostgreSQL）へ保存する。決めるべきは、(1) ローカルDB環境の構築方法（Supabase Local CLI vs 素のPostgresコンテナ）、(2) 保存タイミング（自動保存 vs 保存ボタンによる明示保存）、(3) スキーマ・マイグレーション管理方法である。ユーザーへ確認の上、(1)は「docker-compose内にPostgresコンテナを追加」、(2)は「描画成功時に自動で履歴保存」を選択した。
- **決定**:
  - **ローカルDB**: `docker-compose.yml`に`db`サービス（`postgres:16-alpine`）を追加し、`backend`から`DATABASE_URL`（既定は`postgresql+psycopg://adapt_sheet:adapt_sheet@db:5432/adapt_sheet`）で接続する。Supabase Local CLIは導入しない（Auth/Storage等を含むフルスタックの起動コストを避け、DBの検証に必要な範囲へ絞るため）。本番はSupabaseプロジェクトのPostgres接続文字列で`DATABASE_URL`を上書きする想定。
  - **スキーマ**: SQLAlchemy 2.0（`app/models.py`）で`render_history`テーブル（`id`/`user_id`/`engine`/`html`/`css`/`json_data`/`width_mm`/`height_mm`/`created_at`）を定義する。`user_id`はSupabaseのJWT `sub`をそのまま`String`で保持し、`auth.users`への外部キー制約は張らない（本DBが`auth`スキーマを所有しないため）。Postgres専用型（`JSONB`/`UUID`）ではなくSQLAlchemy汎用型（`JSON`/`Uuid`）を使い、pytestではSQLiteのin-memory DBへ同じメタデータを適用して実PostgreSQLなしに検証できるようにする。
  - **マイグレーション**: Alembic（`backend/migrations/`）を導入する。`alembic.ini`に接続文字列は書かず、`migrations/env.py`が`DATABASE_URL`環境変数を読む（秘密情報をリポジトリに残さないため）。
  - **保存タイミングとエンドポイント**: `POST /api/render`が成功した直後、ログイン中（`current_user`がNone以外）かつDB接続可能（`DATABASE_URL`設定済み）の場合のみ、`app/services/history.save_history`で1行保存する。DB保存の失敗は`try/except`で握りつぶし警告ログのみ残す（描画自体は成功しているため、DB保存の可否でユーザー向けレスポンスの成否を左右しない）。一覧取得は`GET /api/history`（ログイン必須、`current_user`がNoneなら403 `FREE_ACCESS_FORBIDDEN`）で新しい順に最大50件返す。
  - **依存性注入**: `app/db.py`は`get_db_session`（DB必須、未設定ならRuntimeError）と`get_db_session_or_none`（未設定ならNoneを返す）の2種類を公開する。`/api/render`は後者を使いDB未設定でも描画自体を止めない。`/api/history`は前者を使う（DB無しでの一覧取得はそもそも成立しないため）。
- **理由**: 素のPostgresコンテナは既存の`docker compose up`フローにそのまま統合でき、Supabase Local CLIのような多コンテナスタックの起動コスト・新規ツール導入を避けられる。自動保存は「保存を意識させない」体験を優先し、明示的な保存ボタンのUI設計判断を本ステップの対象外にできる。SQLAlchemy汎用型を使うことで、実PostgreSQLを起動しないpytestでもモデル・保存/取得ロジックを検証できる（CLAUDE.mdのTDD徹底）。
- **トレードオフ**: 保存済み履歴を画面上で閲覧・復元するUI（クライアント側の`HistorySlider`とは別の「サーバー保存履歴」ビュー）は本ステップでは実装しない（残課題、docs/spec.md 5章）。名前付きテンプレート機能も対象外。Supabase Local CLIを使わないため、Auth（`auth.users`）との整合はローカルでは検証できず、`user_id`の外部キー制約なしという設計を本番でも維持する。
  - **追記（残課題の解消）**: 上記「サーバー保存履歴ビュー」は`frontend/src/components/HistoryArchive.tsx`として実装した。ログイン確定時にhistoryが空であれば`GET /api/history`から取り直して`HistorySlider`の最大10件枠を復元し（`sheetStore.hydrateHistoryFromServer`）、それより古い過去データは`HistoryArchive`が開いたときにのみ同エンドポイントを呼び直して一覧表示・復元する（既存の50件上限はそのまま。真のページネーションは未実装）。
- **関連**: ADR-007（認証・DBにSupabase採用）、ADR-009（Docker Compose化）、ADR-016（軽量イメージ、psycopg[binary]の選定理由と同じ方針）、ADR-018（JWT検証・`current_user`）。

---

## ADR-020: Supabase Local CLIの導入とJWT検証のJWKS/ES256対応（ADR-019の一部改訂）

- **ステータス**: Accepted
- **コンテキスト**: ステップ27で実装したSupabase Authのログイン・ゲート機能を、実際に登録したユーザーでローカル検証したいという要望が生まれた。ADR-019では「Auth/Storage等を含むフルスタックの起動コストを避ける」ためSupabase Local CLIを導入しない決定をしており、その結果「Authとの整合はローカルでは検証できない」ことを既知のトレードオフとして許容していた。今回その制約を解消するため、Supabase Local CLI（`supabase start`）を導入してAuthのみローカルで検証可能にする（生成履歴用の`db`サービスはADR-019の設計のまま維持し、置き換えない）。導入の過程で、ローカルCLIが発行するJWTが`app/services/auth.py`の前提（HS256共有シークレット）と異なることが判明した。
- **決定**:
  - **Supabase Local CLIの導入**: `supabase init`でリポジトリ直下に`supabase/config.toml`を追加し、`supabase start`でPostgres・GoTrue（Auth）・Studio等のローカルスタックを起動する（Docker Composeとは別の、Supabase CLI自身が管理するコンテナ群）。既存の`db`サービス（ADR-019）は生成履歴（`render_history`）保存専用のまま維持し、Supabase CLI側のPostgres（`auth.users`等）とは統合しない。両者は最初から`user_id`に外部キー制約を張らない設計（ADR-019）のため、DBが分かれていても支障はない。
  - **JWT検証のJWKS/ES256対応**: Supabase Local CLIは既定でJWT Signing Keys機能（ES256非対称鍵、`/auth/v1/.well-known/jwks.json`で公開鍵を配布）でトークンを発行し、ADR-018で決めたHS256共有シークレット方式では検証できないことを確認した。`app/services/auth.py`の`get_current_user`を、トークンヘッダーの`alg`でHS256（共有シークレット、`SUPABASE_JWT_SECRET`）とES256/RS256（JWKS、新環境変数`SUPABASE_JWT_JWKS_URL`、`PyJWKClient`で取得）の両方に振り分ける実装へ変更した。どちらの環境変数も未設定の場合はfail-closed（未ログイン扱い）のまま変わらない。
  - **接続経路**: フロント（ブラウザ）は`VITE_SUPABASE_URL=http://127.0.0.1:54321`へ直接アクセスする（ホスト上で完結するため追加設定不要）。バックエンドコンテナはJWKS取得のためネットワーク到達が必要で、Docker Desktop（Mac/Windows）の`host.docker.internal`経由でホスト側のSupabase CLIコンテナへ到達する（`SUPABASE_JWT_JWKS_URL=http://host.docker.internal:54321/auth/v1/.well-known/jwks.json`）。
  - **`supabase/config.toml`の調整**: `project_id`をワークツリーディレクトリ名依存の自動生成値から固定値`adapt-sheet`へ変更（Git Worktreeごとに値が変わらないようにするため）。`site_url`/`additional_redirect_urls`をフロントの実ポート（5173）に合わせた。
- **理由**: 生成履歴用DBとAuth用ローカルスタックを分離したまま維持することで、ADR-019の主要な決定（起動コストを抑えた素のPostgresコンテナ）は変更せずに済む。JWKS対応は、Supabase Local CLIだけでなく、今後実際にSupabaseプロジェクトを作成する際（同じくJWT Signing Keysが既定の可能性が高い）にも通る変更であり、ADR-018が想定していたリスクへの先行対応になる。`alg`による分岐でHS256側の既存の挙動・テストを変更せずに済む。
- **トレードオフ**: 開発者ごとにホストで`supabase start`を実行する必要があり、Docker Composeの`docker compose up`一発では完結しなくなる（`README.md`のクイックスタートへの追記が必要）。`host.docker.internal`はDocker Desktop（Mac/Windows）前提のため、Linux環境では別途到達経路の検討が必要（未検証、残課題）。Supabase CLIが将来デフォルトの署名鍵方式を変更した場合、再度この対応が必要になる可能性がある。
- **関連**: ADR-007（認証・DBにSupabase採用）、ADR-018（JWT検証・ゲート判定、HS256方式の当初決定とトレードオフ）、ADR-019（生成履歴DBの分離、Supabase Local CLI不使用の当初決定）。

---

## ADR-021: ログイン専用化とセキュリティ強化（新規登録廃止・Google OAuth・RLS・XSS対策）

- **ステータス**: Accepted
- **コンテキスト**: ステップ27で実装したログイン機能は、画面から誰でも新規登録できる状態だった。本プラットフォームは不特定多数への公開を前提としないため、アカウント発行を管理者の操作に限定したいという要件が生まれた。あわせて、ログイン機能をベストプラクティスに沿って強化する（Google OAuth・セッション管理・チラつき防止・トークン保管のXSS対策・DB側のRLS）。調査の過程で、プレビュー用iframeに`sandbox`属性が無く、AI生成HTMLが親ページと同一オリジンで実行できる（＝保管中のアクセストークンを読み出せる）状態であることが判明した。
- **決定**:
  - **新規登録の廃止とアカウント発行手段**: `AuthPanel`から新規登録ボタンを、`authStore`から`signUpWithPassword`を削除する。UIを消すだけではGoTrueの`/auth/v1/signup`を直接叩けてしまうため、`supabase/config.toml`の`[auth] enable_signup = false`でサーバー側も塞ぐ。アカウント発行は`scripts/create_user.sh`（Admin APIの`POST /auth/v1/admin/users`をservice_roleキーで呼び、`email_confirm=true`で確定済みユーザーを作成）に一本化する。なお`[auth.email] enable_signup`はSupabase CLIがGoTrueの`EXTERNAL_EMAIL_ENABLED`へマップするため、falseにするとログイン自体が不能になる（`email_provider_disabled`）。ここはtrueのまま維持する。
  - **Google OAuth**: `supabase/config.toml`に`[auth.external.google]`を追加し、client_id/secretは`env(...)`でリポジトリ外から与える。フロントは`signInWithOAuth({ provider: 'google' })`で認可コードフローを開始する。`enable_signup = false`との組み合わせにより、事前に同じメールアドレスのアカウントを作っておかない限りGoogleログインは成立しない（勝手にユーザーが増えない）。
  - **セッション管理**: `createClient`に`flowType: 'pkce'`を指定する（SPAはクライアントシークレットを秘匿できず、implicitフローはアクセストークンをURLフラグメントへ露出させるため）。`authStore.init`は`onAuthStateChange`の購読解除関数を返し、`App`の`useEffect`クリーンアップで解除する（StrictModeの二重実行でリスナーが積み上がるのを防ぐ）。
  - **チラつき（Flash）防止**: `authStore`に`isInitializing`を追加し、`getSession()`の解決（失敗時も含む）まで`true`にする。`AuthPanel`はその間、高さだけ確保した空要素を返す。復元前に「ログイン」ボタンを描いてから「ログイン済み」表示へ入れ替わる挙動と、それに伴うヘッダーのレイアウトシフトを同時に防ぐ。
  - **トークン保管とXSS対策（多層）**: (1) プレビューiframeに`sandbox=""`を付ける。`srcdoc`はsandbox未指定だと親と同一オリジンで動作し、AI生成HTMLや復元した履歴に`<script>`が混ざるとトークンを読み出せるため、これを最優先で塞ぐ（帳票は静的なHTML/CSSのみで成立するのでスクリプト実行の需要はない）。(2) セッションの保管先を`localStorage`から`sessionStorage`へ変更し、タブを閉じた時点で破棄する。(3) ビルド成果物にCSPの`meta`タグを注入する（Vite開発サーバーはFast Refreshのインラインscriptとwebsocketを使うため、開発時には適用しない）。
  - **RLS（行レベルセキュリティ）**: 生成履歴の保存先をSupabaseのPostgresへ統合し（ADR-019の「素のPostgresコンテナ」を改訂、`db`サービスは廃止）、`render_history`に`ENABLE`／`FORCE ROW LEVEL SECURITY`とSELECT/INSERT/DELETEのポリシー（`user_id = auth.uid()::text`）を定義する。アプリは`BYPASSRLS`属性を持たない`authenticator`ロールで接続し、リクエストごとに`set_config('request.jwt.claims', ..., true)`でJWTの`sub`を渡してから`SET LOCAL ROLE authenticated`する（PostgRESTと同じ方式）。マイグレーションは所有者権限が必要なため`MIGRATION_DATABASE_URL`（`postgres`ロール）を別途使う。
- **理由**: 新規登録の禁止は、UI・GoTrue設定の二重で担保しないと実効性がない。RLSはアプリ側のWHERE句に依存しない最後の防波堤であり、クエリの書き漏れやSQLインジェクションがあっても他人の行へ到達できない。トークン保管については、SPAである以上どの保管先でもXSS下では窃取され得るため、保管先の変更（被害時間の短縮）だけでなく、実際に存在した実行経路（sandbox無しiframe）を塞ぐことを主対策とした。
- **トレードオフ**: `sessionStorage`はタブを閉じるとログアウトするため、ブラウザ再起動後もログインを維持したい運用には向かない（真にXSS耐性を持たせるにはhttpOnly Cookie＋BFFが必要で、本ステップの範囲外）。`user_id`は`auth.users`への外部キーを張らず`TEXT`のまま維持した（UUIDへ移行すると、非UUIDのIDを使う既存テスト群の広範な書き換えが必要になるため。RLSの保護内容はポリシーの`::text`比較で同等）。CSPは`meta`タグのため`frame-ancestors`等を解釈できず、本番はCloudFrontの応答ヘッダーで別途付与する必要がある（未実装、残課題）。Google OAuthの動作確認にはGoogle Cloudで発行したOAuthクライアントが必要で、未設定のままでは`supabase start`が警告を出し、Googleログイン押下時にエラーになる。
- **関連**: ADR-015（ゲート対象エンジン）、ADR-018（JWT検証・`current_user`）、ADR-019（生成履歴の永続化。本ADRでDBの置き場所を改訂）、ADR-020（Supabase Local CLI導入・JWKS対応）。

---

## ADR-022: ログイン手段のGoogleアカウント限定（ADR-021の一部改訂）

- **ステータス**: Accepted
- **コンテキスト**: ADR-021ではログイン手段としてメール＋パスワードとGoogleアカウントの2つを併存させていた。しかしパスワードは、強度・使い回し・保管・リセット導線といった管理コストをすべて自前で抱えることになる。利用者が限定された社内向けプラットフォームであり、アカウント発行も管理者のコマンド操作に限定済み（ADR-021）であることから、認証をGoogleへ委譲して自前のパスワードを持たない方針とする。あわせて「Google OAuthが設定されていない環境ではアカウントを作れない」ことを保証したい（作っても本人がログインできず、無効なアカウントだけが増えるため）。
- **決定**:
  - **パスワードログインの廃止**: `supabase/config.toml`の`[auth.email] enable_signup = false`を設定する。ADR-021ではこの項目がSupabase CLIによってGoTrueの`EXTERNAL_EMAIL_ENABLED`へマップされ「ログインまで無効になる」ことを問題として避けたが、本ADRでは**その挙動を意図的に利用**してメール＋パスワードでのログインを塞ぐ（`email_provider_disabled`が返る）。フロントも`authStore.signInWithPassword`と`AuthPanel`の入力欄を削除し、UIは「Googleでログイン」ボタンのみにする。
  - **アカウント作成のガード**: `scripts/create_user.sh`は、`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`/`..._SECRET`が未設定なら作成を拒否する。加えて、値が`env(...)`というリテラルのままの場合も拒否する（`supabase start`実行時のシェルに環境変数が無いと`config.toml`の`env(...)`が展開されず、一見有効なのにログインだけが失敗する状態になるため。実際にこの状態が発生した）。さらにGoTrueの`/auth/v1/settings`を参照し、サーバー側でgoogleプロバイダが有効であることも確認する。
  - **パスワードを設定しない**: 同スクリプトはAdmin APIで`email`と`email_confirm=true`のみを指定し、パスワードを設定しない（メールプロバイダが無効なため、設定しても使えない）。作成したメールアドレスと同じGoogleアカウントでログインすると、GoTrueが同一メールアドレスのidentityを自動的に紐付ける。未登録のGoogleアカウントは`[auth] enable_signup = false`により弾かれる。
- **理由**: パスワードを持たなければ、パスワード起因の脆弱性（総当たり・使い回し・漏洩時の影響）が構造的に発生しない。認証強度（2要素認証等）の担保をGoogle側へ委譲でき、退職者のGoogleアカウント停止がそのままアクセス遮断につながる運用上の利点もある。アカウント作成時のガードは、ログイン不能なアカウントが作られる事故を、発生前に止める。
- **トレードオフ**: Googleアカウントを持たない利用者は登録できない。ローカル開発でもGoogle Cloudで発行したOAuthクライアント（client_id/secret）が必須になり、未設定ではログインを検証できない（`docs/supabase-local-cli-setup.md`に取得手順を記載）。またGoTrueがOAuthログイン時に同一メールアドレスの既存ユーザーへidentityを自動連携する挙動に依存している（実際のGoogle OAuthクライアントでログインし、`email` identityを持つ既存ユーザーへ`google` identityが追加されることを`auth.identities`で確認済み）。ただしこれはSupabaseの仕様変更で崩れ得るため、バージョン更新時は再確認する。
- **関連**: ADR-018（JWT検証）、ADR-020（Supabase Local CLI）、ADR-021（新規登録廃止・Google OAuth追加・RLS。本ADRでログイン手段を限定）。

---

## ADR-023: ホスト側開発ツールのバージョン管理をmiseへ一本化

- **ステータス**: Accepted
- **コンテキスト**: アプリ本体はDocker Composeで動く（ADR-009）ため、コンテナ内のPython/Nodeは`Dockerfile`のベースイメージでバージョンが固定されていた。一方でTerraform・AWS CLI・Supabase CLI・GitHub CLIといった**ホスト側で直接実行するツール**にはバージョンの取り決めが無く、`brew install`で入れた各自の最新版に依存していた。特にTerraformは、実行するバイナリのバージョンがstateファイルへ記録され、新しいバージョンでapplyするとそれ以前のバージョンでは操作できなくなるため、意図しないバージョンでの実行を防ぎたい。`infra/versions.tf`の`required_version = ">= 1.6.0"`は下限しか縛らず、この用途には不十分だった。
- **決定**:
  - リポジトリ直下の`mise.toml`で、ホスト側ツールのバージョンをパッチまで固定する（terraform / node / python / awscli / supabase / gh）。導入は`brew install mise`＋シェルへの`mise activate`、利用は`mise install`。
  - node/pythonは`docker-compose.yml`が使うベースイメージ（`node:20-alpine` = 20.20.2、`python:3.9-slim` = 3.9.25）と同じパッチバージョンに合わせる。ホストで補助コマンド（型生成・スクリプト）を動かしたときにコンテナと挙動が食い違わないようにするため。
  - `infra/versions.tf`・`infra/bootstrap/main.tf`の`required_version`を`~> 1.15`へ引き上げる。バージョン固定の一次ソースは`mise.toml`とし、こちらはmiseを経由せず実行された場合のガードとして機能させる。
  - `.terraform.lock.hcl`をコミット対象に含める（従来は`.gitignore`で除外していた）。`terraform providers lock -platform=darwin_arm64 -platform=linux_amd64`で開発機（Apple Silicon）とCI（Linux）の両方のチェックサムを記録する。
- **理由**: バージョンの取り決めをREADMEの文章ではなくリポジトリ内の設定ファイルに置くことで、ディレクトリに入るだけで全員が同じバイナリを使う状態になる（asdf互換の`.tool-versions`より、コメントや`min_version`を書けるTOML形式を選んだ）。Terraform本体の固定だけではproviderのバージョンが揺れるため、lockファイルのコミットまで含めて初めて「同じ入力なら同じplan」が成立する。
- **トレードオフ**: mise未導入の環境では従来どおりPATH上のバイナリが使われるため、強制力はない（CIでの強制は未対応、残課題）。パッチ固定はバージョン更新を自動で受け取れないため、更新は`mise.toml`の編集＋PRという明示的な操作になる（意図した挙動）。node/pythonのバージョンを`Dockerfile`と`mise.toml`の2箇所で持つことになり、ベースイメージ更新時は両方を揃える必要がある。
- **関連**: ADR-005（IaC一本化）、ADR-009（Docker Compose前提のローカル開発）、ADR-017（Lambda本番イメージ・SSM）、ADR-020（Supabase Local CLI）。

---

## ADR-024: エディタ（Zed）のリンター/フォーマッターをDockerコンテナ内で動かす

- **ステータス**: Accepted
- **コンテキスト**: 開発環境はDocker Composeのみを対象としており（ADR-009）、ホストにはPython・Nodeの実行環境を用意していない。一方でエディタ（Zed）は既定でホスト上の言語サーバー（pyright等）を起動しようとするため、そのままでは診断が出ないか、ホストへruff/ESLintを二重に導入してコンテナ側とバージョンがずれる。ホスト側ツールのバージョンはmiseで固定しているが（ADR-023）、リンターはコンテナ内の`requirements.txt`/`package.json`が一次ソースであり、mise管理へ移すのは筋が悪い。
- **決定**:
  - `docker-compose.yml`に`lsp`プロファイルの`backend-lsp`（`ruff server`）と`frontend-lsp`（`vscode-eslint-language-server`）を追加し、`scripts/zed-lsp.sh`が`docker compose run --rm --no-deps -T`で1プロセスずつ起動する。常駐させず、起動・終了はエディタに任せる。
  - LSPはファイルを絶対パス（URI）でやり取りするため、両サービスはリポジトリを**ホストと同一の絶対パス**（`${PWD}`）へマウントする。コンテナ側でのパス読み替えを不要にし、診断の位置ズレや設定ファイルの探索失敗を防ぐ。
  - ESLintのflat configはプラグインをESMのbare importで解決するため、`NODE_PATH`やイメージ内`/app/node_modules`では代替できない。ホスト側の空の`frontend/node_modules`に名前付きボリューム`frontend_lsp_node_modules`を被せ、初回起動時にイメージ内の依存をコピーする（`frontend/scripts/lsp-entrypoint.sh`）。
  - `vscode-languageserver`はinitializeで受け取った`processId`をkill(0)で監視し、見つからなければ自らexitする。ホストのPIDはコンテナから見えず必ず失敗するため、`frontend/scripts/eslint-lsp-launcher.js`が`processId`のみをnullへ書き換えて中継する（終了はstdinのEOFで伝わる）。
  - 保存時の挙動は現状の開発フローに合わせる。TypeScript/ReactはPrettier未導入のため、Zed同梱のPrettierを無効化してESLintの`source.fixAll.eslint`のみ適用する。Pythonは既存コードが`ruff format`未適用（50ファイル中32ファイルに差分）のため、フォーマッターの定義だけ行い保存時の自動整形は無効にする。
- **理由**: リンターの一次ソースをコンテナ内の依存定義に一本化できるため、`docker compose exec ... ruff check` / `npm run lint`とエディタ上の診断が同じバージョン・同じ設定で一致する。同一絶対パスでのマウントは、LSPにパス変換の仕組みが無い以上もっとも副作用が少ない回避策である。
- **トレードオフ**: LSPの起動ごとに`docker compose run`のオーバーヘッド（数秒）が乗る。`${PWD}`展開に依存するため、`scripts/zed-lsp.sh`を経由せずcwdの異なる場所からLSPサービスを起動するとマウント位置がずれる。`.zed/settings.json`の`binary.path`はZedが相対パスを解決しないため絶対パス固定であり、クローン先が異なる環境では`scripts/setup-zed.sh`の実行が必要。型チェック（vtsls/pyright）は対象外で、リンター/フォーマッターのみをDocker化している。
- **関連**: ADR-009（Docker Compose前提のローカル開発）、ADR-023（ホスト側ツールのバージョン固定）。

---

## ADR-025: 編集中スナップショットを履歴へ複数件登録する

- **ステータス**: Accepted
- **コンテキスト**: 履歴は描画結果のみを積む設計で、未描画の編集内容は「履歴クリックで上書きされる直前」に退避される単一スロット（`draft`）だけだった。そのため、描画に至らない編集の途中経過は1件しか残らず、少し前の状態へ戻ることができない。ログインユーザーのサーバー側履歴（ADR-019）も描画成功時のみ保存され、編集途中は一切残らない。
- **決定**:
  - 履歴の1件に種別（`kind`: `render` / `edit`）を持たせ、編集中スナップショットを描画結果と同じ1本の履歴列へ時系列で混在させる。上限は従来どおり合計10件で、超過分は最古から破棄する。
  - スナップショットは入力が止まってから`EDIT_SNAPSHOT_DELAY_MS`（1.5秒）後に1件積む。1打鍵ごとでは履歴が即座に埋まり、明示ボタン方式では「編集した時点で残る」という要求を満たさないため、連続入力を1件へまとめる中間をとる。内容が空、または既存の履歴と同一の場合は積まない。
  - **編集中スナップショットを編集し続けている間は履歴を増やさず、同じ1件を上書きする**（ストアの`activeEditSeq`が上書き先を指す）。新しい編集中スナップショットが生まれるのは「描画結果を編集したとき」と「描画履歴を復元して編集したとき」だけで、編集中の履歴を復元した場合はその1件の続きとして扱う。ログイン時のサーバー側も同様に、2回目以降は`PUT /api/history/edit/{id}`で同じ行を上書きする（行の増加を抑えるため、RLSに所有者UPDATEポリシーを追加）。
  - 履歴の復元・描画の直前に保留中のスナップショットを確定させ、待ち時間の途中で編集内容が失われないようにする（`draft`スロットと`restoreDraft`は廃止）。
  - ログイン時は編集スナップショットの登録ごとに`POST /api/history/edit`で`kind="edit"`として保存する。描画とは違い画面の主目的ではないため、レスポンスは待たず失敗も画面へ出さない。
  - DBは`render_history`へ`kind`列（`server_default='render'`）を追加する。既存行はすべて描画結果として扱う。
- **理由**: 編集の途中経過は描画結果と同じ「戻れる状態」であり、別UIへ分けるより1本の時系列に並べるほうが操作が単純になる。種別を持たせるだけで、点線枠と「編集中」バッジによる見分けと、サーバー側での区別の両方が同じ1つの属性で表現できる。
- **トレードオフ**: 編集が活発なときは編集スナップショットが10件枠を占め、古い描画結果が押し出される（枠を分ける案は表示が複雑になるため採らなかった）。ログイン時は編集のたびに書き込みが発生するため、DBの行数は描画のみの場合より増える。待ち時間（1.5秒）より短い間隔で意味のある状態を作った場合、その中間状態は履歴に残らない。
- **関連**: ADR-019（生成履歴の永続化）、ADR-021（RLS。`kind`追加はポリシーに影響しない）。

---

## 今後の追記予定

- フェーズ4・5の実装過程で発生した追加の技術決定（Terraformのstate管理方式、Supabaseのスキーマ設計方針等）を随時ADRとして追記する。
