# ログ・可観測性（運用ガイド）

設計判断の背景は [ADR-011](./decisions.md)（構造化ログ）と [ADR-030](./decisions.md)（ログ・可観測性の設計）を参照。本ドキュメントは「障害・問い合わせが来たときにどこを見るか」の手順書。

## 1. どこに何が残るか

| 記録 | 保存先 | 保持期間 | 主に分かること |
| --- | --- | --- | --- |
| backendアプリログ（JSON1行） | CloudWatch Logs `/aws/lambda/adapt-sheet-prod-backend` | `log_retention_in_days`（既定30日） | 相関ID・user_id・エンジン・例外スタックトレース |
| docling / pdf2htmlex アプリログ | CloudWatch Logs `/aws/lambda/adapt-sheet-prod-{docling,pdf2htmlex}` | 同上 | 内部変換サービスの成否と所要時間 |
| API Gatewayアクセスログ（JSON1行） | CloudWatch Logs `/aws/apigateway/adapt-sheet-prod-api/access` | 同上 | 送信元IP・ステータス・レイテンシ。**429（スロットリング）はここにしか残らない** |
| API Gateway実行ログ | CloudWatch Logs（API Gatewayが自動作成） | AWS既定 | 統合エラーの詳細（`logging_level = ERROR`） |
| CloudFrontアクセスログ | S3 `adapt-sheet-prod-cf-logs-<account_id>/cloudfront/` | 同上（ライフサイクルで失効） | 公開エンドポイントへの全アクセス（静的アセットを含む） |
| 分散トレース | AWS X-Ray | X-Ray既定 | backend→docling/pdf2htmlexのどこで時間を使ったか |
| Supabase Auth / Postgres ログ | Supabaseダッシュボード（Logs） | **プラン依存・短期** | ログイン試行、RLS拒否、DB側のエラー |

**一次ソースはCloudWatch**。Supabaseのログは保持期間が短くTerraform管理外のため、Supabase内部でしか起きない事象（ログイン失敗・RLS拒否）の調査に限って参照する（ADR-030）。

## 2. 相関のたどり方

1. 画面に出たエラーには `request_id` が表示される（ADR-012）。レスポンスの `X-Request-ID` ヘッダーと同値。
2. その `request_id` でbackendのロググループを引く。同じIDが**内部サービス側のログにも付く**（backendが `X-Request-ID` ヘッダーで伝播している）。
3. API Gatewayのアクセスログとの突き合わせは `xrayTraceId`（LambdaへはX-Amzn-Trace-Idとして渡る）で行う。

```
fields @timestamp, level, logger, message, user_id, engine, service, upstream_status, reason
| filter request_id = "貼り付けたID"
| sort @timestamp asc
```

ロググループを3本まとめて選択して実行すると、backend・docling・pdf2htmlexが1本の時系列に並ぶ。

## 3. よく使うCloudWatch Logs Insightsクエリ

エラーだけを新しい順に:

```
fields @timestamp, request_id, user_id, message, reason, exc_info
| filter level = "ERROR"
| sort @timestamp desc
| limit 50
```

遅いリクエストの特定:

```
fields @timestamp, request_id, path, duration_ms, user_id
| filter ispresent(duration_ms) and duration_ms > 10000
| sort duration_ms desc
```

スロットリング（429）の発生状況 — **API Gatewayのアクセスログ**のロググループに対して実行する:

```
fields @timestamp, sourceIp, path, status
| filter status = 429
| stats count() by bin(5m)
```

特定ユーザーの操作履歴（監査）:

```
fields @timestamp, method, path, status_code, engine
| filter user_id = "対象のsub"
| sort @timestamp asc
```

JWT検証に失敗しているリクエストの原因:

```
fields @timestamp, request_id, reason
| filter logger = "app.auth"
| sort @timestamp desc
```

## 4. アラーム

通知はSNSトピック（`terraform output alarm_topic_arn`）へ集約される。メール通知は `alarm_email` を設定すると購読が作られる（**購読確認メールのリンクを踏むまで届かない**）。

| アラーム | 発報条件 | 最初に見る場所 |
| --- | --- | --- |
| `*-backend-errors` 等 | Lambdaが例外で終了（5分で1件以上） | 該当関数のロググループ、`level = "ERROR"` |
| `*-throttles` | Lambdaが同時実行数上限で絞られた | 同時アクセス増を疑う。メモリ設定と同時実行の見直し |
| `*-api-5xx` | API Gatewayが5XXを返した | API Gatewayアクセスログの `integrationError` |
| `*-api-4xx` | 4XXが5分で20件以上 | アクセスログで429か403かを確認。429ならADR-027の閾値見直し |
| `*-backend-app-errors` | アプリログにERRORが出た | ADR-012で500へ丸められた想定外例外。**Lambdaの`Errors`には出ない**ため、これが唯一の検知経路 |

## 5. ログに載せてはいけないもの

- APIキー・JWT本体・パスワード（ADR-011）
- PDFのバイト列、リクエストボディ全文
- 生成AIの入出力全文 — `LOG_AI_PAYLOAD` で切り替わる。帳票の業務データを含むため**本番では有効化しない**（ローカルの `docker-compose.yml` のみ `true`）
- API Gatewayの `data_trace_enabled` は常に `false`。有効にするとリクエスト/レスポンス本文がロググループへ書き出される

`user_id` はSupabaseの `sub`（UUID）であり、メールアドレスや氏名は載せない。

## 6. Supabase側のログ

Supabaseのログ（Auth・Postgres・PostgREST）は**プラットフォーム管理**でTerraformの管理対象外、かつ保持期間がプラン依存（無料プランは短い）。**アプリの一次的な監査ログとして当てにしない**（ADR-030）。次の事象を調べるときだけ参照する。

| 見たいこと | 場所 |
| --- | --- |
| ログイン試行の成否、OAuthのエラー | ダッシュボード → Logs → Auth Logs |
| RLSポリシーによる拒否、SQLエラー | Logs → Postgres Logs |
| PostgRESTのリクエスト（フロントのSDK経由の履歴取得） | Logs → API / PostgREST Logs |

ローカル検証時は `supabase start` 後に Studio（<http://127.0.0.1:54323>）の Logs から同じものを見られる（`config.toml` の `[analytics] enabled = true` が前提）。手順は [supabase-local-cli-setup.md](./supabase-local-cli-setup.md) を参照。

**「誰がいつ何を描画したか」はSupabase側を見なくても分かる**。backendのアクセスログに `user_id`（Supabase JWTの `sub`）が載っているため、CloudWatch側だけで完結する。`render_history` テーブルは業務データの記録であって監査ログではない（利用者本人が削除できるため、監査目的では信頼しない）。

## 7. ローカルでの確認

ログは1行1レコードのJSONなので `jq` で読む。

```bash
docker compose logs -f backend | jq -R 'fromjson? // .'
docker compose logs backend | jq -R 'fromjson? // empty | select(.level == "ERROR")'
docker compose logs backend | jq -R 'fromjson? // empty | select(.request_id == "対象のID")'
```
