# アーキテクチャ決定記録 (ADR)

`adapt-sheet` における主要な技術選定の背景・理由・トレードオフを記録する。各決定は [`planning/brainstorm.md`](../planning/brainstorm.md) の構想を踏まえたもの。

ステータス: `Proposed`（提案中）/ `Accepted`（採用）/ `Superseded`（後継決定により置換）/ `Deprecated`（非推奨）

システム構成に影響しない微調整（コメント規約・Worktree運用・ログのオプトイン設定等）はADRとして記録せず、必要な範囲でCLAUDE.mdやコード側の記述に留める。

## ADRに記載しないもの

以下に該当する変更は、たとえ作業に一定の時間を要したものであってもADRを新設しない。既存ADRへの一言追記（コンテキスト・トレードオフへの追記）や、CLAUDE.md・コミットメッセージ・PR説明への記載に留める。

- **バグ修正**: 設計判断を伴わない不具合の修正。
- **ソースを読めば分かるロジック変更**: 実装を読めば意図が追える程度の処理変更。命名・関数分割で意図が伝わる場合はコメントも書かない（CLAUDE.mdのコード規約参照）。
- **公開前のインフラ変更**: 本番未リリースの段階で行うインフラ構成の変更・訂正（後から設計自体が変わりうるため、確定後に必要な範囲でまとめて記録する）。
- **設計**: 実装の詳細設計（クラス構成・関数シグネチャ等）そのもの。ADRは「なぜその選択をしたか」という決定に絞る。
- **微調整**: 既存の決定の範囲内でのパラメータ調整・軽微な改善。
- **セキュリティに関する決定は分割しない**: 関連するセキュリティ判断が複数回に分かれて生まれた場合も、都度ADRを新設せず既存の1つのADRへ追記・改訂して集約する。
- **ログ・監視・エディタ設定等の周辺整備**: 該当する既存ADR（構造化ログ基盤・Docker Compose化等）へ一言添えるに留め、独立したADRは起こさない。

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
- **トレードオフ**: Docker Desktop（またはOCI互換ランタイム）が無いと開発できない。初回ビルド時はDocling/torch等の大容量パッケージのダウンロードで時間がかかる。本Dockerfileはローカル開発専用であり、本番用コンテナ化とは別物である。
- **追記**: エディタ（Zed）のリンター/フォーマッターも、ホストに二重導入せず本構成のDocker Compose内（`lsp`プロファイル）で動かす。設定詳細は`.zed/settings.json`・`scripts/zed-lsp.sh`・CLAUDE.mdを参照。

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
- **追記**: 本番環境ではこのアプリケーションログをCloudWatch側の記録・アラーム（メトリクスフィルタ）・X-Rayによるサービス間相関へ接続している。詳細はGitログ・Terraform（`infra/modules/monitoring`）を参照。

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

## ADR-020: 認証のセキュリティ強化（JWT検証方式・ログイン手段の限定・RLS・XSS対策）

- **ステータス**: Accepted
- **コンテキスト**: Supabase Authの導入後、認証まわりで複数のセキュリティ判断を行った。JWT検証はSupabase Local CLIの既定署名方式（JWKS/ES256）に合わせて共有シークレット方式から拡張し、ログイン手段は「誰でも新規登録できる」状態から管理者発行・Googleアカウント限定へ絞り込み、あわせてプレビューiframe経由でアクセストークンを読み出せる経路の遮断・RLSの追加を行った。これらは個別の事象を発端としているが、いずれも認証境界の強化という同じ目的の決定であるため1つのADRへ集約する。
- **決定**:
  - **JWT検証**: `app/services/auth.py`の`get_current_user`は、トークンヘッダーの`alg`でHS256（共有シークレット、`SUPABASE_JWT_SECRET`）とES256/RS256（JWKS、`SUPABASE_JWT_JWKS_URL`、`PyJWKClient`）の両方式に振り分けて検証する。`aud`・有効期限も検証し、いずれの環境変数も未設定、または検証失敗時は例外を投げず常にNoneを返す（fail-closed）。
  - **ログイン手段の限定**: 新規登録はUI（`AuthPanel`）から削除し、`supabase/config.toml`の`[auth] enable_signup = false`でサーバー側も塞ぐ。アカウント発行は`scripts/create_user.sh`（Admin API、`email_confirm=true`）に一本化する。ログインはGoogle OAuthのみとし、`[auth.email] enable_signup = false`でメール＋パスワードでのログインも無効化する（パスワード起因の脆弱性を構造的に排除するため）。`create_user.sh`はGoogle OAuthの設定（client_id/secret、およびGoTrue側で有効化されていること）を事前確認し、ログイン不能なアカウントが作られる事故を防ぐ。認可コードフロー（PKCE）を用い、implicitフローによるアクセストークンのURL露出を避ける。
  - **トークン保管とXSS対策（多層）**: (1) プレビューiframeに`sandbox=""`を付ける。AI生成HTMLや復元した履歴に`<script>`が混ざっても、親ページと同一オリジンで実行されずアクセストークンを読み出せないようにする（最優先の対策）。(2) セッションの保管先を`sessionStorage`とし、タブを閉じた時点で破棄する。(3) ビルド成果物にCSPの`meta`タグを注入する。
  - **RLS（行レベルセキュリティ）**: `render_history`に`ENABLE`／`FORCE ROW LEVEL SECURITY`とSELECT/INSERT/DELETE/UPDATEのポリシー（`user_id = auth.uid()::text`）を定義する。アプリはリクエストごとにJWTの`sub`を`SET LOCAL ROLE authenticated`経由で渡す（PostgRESTと同じ方式）。アプリ側のWHERE句の書き漏れやSQLインジェクションに対する最後の防波堤とする。
- **理由**: JWT検証をJWKS/ES256にも対応させることで、Supabase側のデフォルト署名方式（Local CLI・実プロジェクトとも）に依存せず検証できる。パスワードを持たない方針は、パスワード起因の脆弱性（総当たり・使い回し・漏洩時の影響）を構造的に無くし、認証強度の担保をGoogle側へ委譲できる。RLSはアプリ側のロジックとは独立した防御層として機能する。トークン保管については、SPAである以上どの保管先でもXSS下では窃取され得るため、保管先の変更（被害時間の短縮）だけでなく、実際に存在した実行経路（sandbox無しiframe）を塞ぐことを主対策とした。
- **トレードオフ**: `sessionStorage`はタブを閉じるとログアウトするため、ブラウザ再起動後もログインを維持したい運用には向かない（真にXSS耐性を持たせるにはhttpOnly Cookie＋BFFが必要で対象外）。Googleアカウントを持たない利用者は登録できず、ローカル開発でもGoogle CloudのOAuthクライアントが必須になる。CSPは`meta`タグのため`frame-ancestors`等を解釈できず、本番はCloudFrontの応答ヘッダーで別途付与する必要がある。`user_id`は`auth.users`への外部キーを張らず`TEXT`のまま維持している（RLSの保護内容はポリシーの`::text`比較で同等）。
- **関連**: ADR-007（認証・DBにSupabase採用）、ADR-012（構造化エラー）。

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
- **関連**: ADR-005（IaC一本化）、ADR-009（Docker Compose前提のローカル開発）。

---

## ADR-024: 生成AI描画のジョブ非同期化（S3署名付きURL＋Lambda非同期起動）

- **ステータス**: Accepted
- **コンテキスト**: 本番実機検証で、`POST /api/render`が生成AI（Gemini）呼び出し中にAPI Gatewayの統合タイムアウト（29秒固定・AWS側のハード上限で変更不可）へ達し、利用者にエラーとして見える事象が繰り返し発生した。IAM権限・docling初期化コスト・DBセッションclose・Geminiクライアントのタイムアウト未設定など原因を1つずつ特定・修正したが、最終的にGemini API自体がGoogle側の事情で20〜60秒以上かかる／504を返すケースがあることが実機ログで確認された。これは同期リクエスト/レスポンス方式である限りコード側のチューニングだけでは解決できない、アーキテクチャ上の制約だった。
- **決定**: 生成AI系engine（`gemini_free`/`gemini`/`claude`/`openai`/`hybrid`）のレンダリングを非同期ジョブ化する。PDFはS3へ署名付きURLでブラウザから直接アップロードし（入口Lambdaを経由しない）、実処理は`render-worker`という別のLambda関数（入口Lambdaと同じイメージを再利用、タイムアウト180秒）へ`lambda:invoke`（`InvocationType=Event`）で非同期起動する。入口Lambdaはジョブの受理（`pending`状態の書き込みと起動）だけを行い、重い処理を一切待たずに`202 Accepted`を返す。フロントは`GET /api/render/jobs/{job_id}`を2秒間隔でポーリングし、結果（S3上のJSON）を取得する。変換エンジン（Docling/pdf2htmlEX/PyMuPDF）は常に高速なため対象外とし、既存の同期経路のまま変更しない。詳細な処理フローは[`architecture.md`](./architecture.md#41-非同期レンダリングジョブ生成ai系engine)を参照。
  - `render-worker`はAPI Gateway/Function URLを経由しないIAM専用Lambdaとし、入口Lambdaの実行ロールにのみ`lambda:InvokeFunction`を許可する（Function URL呼び出し用の`lambda:InvokeFunctionUrl`とは別の権限）。
  - `render-worker`への中継は、AWS Lambda Web Adapter（Docling/pdf2htmlEXと同じ仕組み）がAPI Gateway REST API v1プロキシ形式の合成イベントをHTTP POSTへ変換する前提で設計し、実装前に小さな検証（合成イベントを手動送信しFastAPI側のログを確認）で成立することを確かめてから本実装した。
  - S3の署名付きURLはリージョナルエンドポイント（`s3.<region>.amazonaws.com`）を明示して発行する。region_nameのみの指定だとboto3はグローバルエンドポイント（`s3.amazonaws.com`）のURLを生成し、実アクセス時にリージョナルエンドポイントへの307リダイレクトが発生する。ブラウザの`fetch`はこのクロスオリジンリダイレクトを安定して扱えず、CORSエラーとして失敗する。
  - S3バケットにはCORS設定（フロントのCloudFrontオリジンからの`PUT`を許可）と、フロントのCSP（`connect-src`）へのS3オリジン追加の両方が必要（片方だけでは失敗する。前者はS3側、後者はブラウザ自身のポリシー）。
  - **ローカル開発での代替**: ローカルのdocker-compose環境には実AWSのS3・render-worker Lambdaが無いため、そのままでは生成AI系engineをブラウザから一切試せない。本番のクラス（`S3JobStore`・`LambdaWorkerInvoker`）自体は変更せず、ローカル専用の代替を外側（設定値・別クラス）で用意した。`job_store.py`はバケット以外のS3エンドポイントを`RENDER_JOBS_S3_ENDPOINT_URL`（内部通信用）/`RENDER_JOBS_S3_PUBLIC_ENDPOINT_URL`（presigned URL発行用、ブラウザから到達できるホスト）として受け取れるようにし、これは実装の分岐ではなく設定値の違いに過ぎないためクラスは1つのまま（docker-compose.ymlがMinIOの`minio`/`minio-init`サービスへ向けて設定し、本番のTerraform側は未設定＝実AWS S3の従来通りの挙動）。`worker_invoker.py`はlambda:invokeとローカルでのbackend自身へのHTTP POSTとで呼び出し手段自体が異なるため、新しいクラス`LocalHttpWorkerInvoker`を追加し（`LambdaWorkerInvoker`は無変更）、`get_worker_invoker()`が`RENDER_WORKER_LOCAL_URL`（ローカルのdocker-compose.ymlのみが設定）の有無で選択する。MinIOはS3と完全互換ではない点（presigned URLのpath-styleアドレッシング等）に留意する。
- **理由**: API Gatewayの29秒統合タイムアウトはAWS側のハード上限で変更できないため、コードのチューニングでは解決できない。S3署名付きURLによる直接アップロードはbackendの帯域・メモリを消費せず、既存のDocling/pdf2htmlEX（Function URL＋Web Adapter）と同じ実行モデルを流用できるため新しい仕組みを持ち込まずに済む。ポーリング方式はWebSocket等より実装・運用がシンプルで、既存の「描画中」UI（経過秒数表示）とも自然に馴染む。ローカル代替は、アプリのロジックが「今どの環境で動いているか」を判定して分岐するのではなく、各環境のデプロイ定義（docker-compose.yml／Terraform）がそれぞれ適切な設定値・環境変数を注入する方針（12-factor appの「設定は環境に持たせる」原則）にした。
- **トレードオフ**: フロントの`fetchRender`が生成AI系engineと変換エンジンで異なる経路（非同期ジョブ／同期呼び出し）を持つことになり、コードパスが増える。ポーリング間隔（2秒）の分だけ結果反映がわずかに遅れる。`render-worker`は入口Lambdaと同じイメージを再利用するため、backend用の依存関係（Docling/pdf2htmlEXクライアント等）も含んだまま起動する（専用の軽量イメージに分離すればコールドスタートを短縮できるが、現時点ではイメージ管理の一本化を優先した）。ローカルの`render-worker`代替は同じbackendコンテナ内で処理するため、本番の別Lambda（別プロセス・別リソース制約）との挙動差はローカルでは検証できない。
- **関連**: ADR-011（構造化ログ、`render-worker`は`request_id`が伝播しないため`job_id`で相関する）。

---

## 今後の追記予定

- フェーズ4・5の実装過程で発生した追加の技術決定（Terraformのstate管理方式、Supabaseのスキーマ設計方針等）を随時ADRとして追記する。

