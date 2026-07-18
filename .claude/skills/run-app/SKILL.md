---
name: run-app
description: adapt-sheetのバックエンド(FastAPI/uvicorn)とフロントエンド(Vite)をDocker Compose経由でバックグラウンドで起動・停止し、起動/停止できているかどうかのみを確認する。テスト実行は行わない。「起動して」「画面を確認したい」「アプリを閉じて/落として」等のリクエストで使用する。
---

# adapt-sheet 起動・停止手順（Docker Compose）

バックエンド・フロントエンドを起動/停止し、**その状態確認のみ**を行う。
pytest/vitest等のテストスイートは実行しない。

<!-- 開発環境はDocker Composeのみを対象とし、ローカル(非Docker)での直接実行はサポートしない
     （ルートCLAUDE.md/ADR-010）。本スキルもコンテナ起動前提に統一する。 -->

## 前提

- `docker-compose.yml` にfrontend/backendの2サービスが定義済み（e2eサービスは`profiles: [e2e]`でopt-inのため対象外）
- バックエンドはホストのポート8000、フロントエンド(Vite)はホストのポート5173にマッピングされる（`docker-compose.yml`参照）
- Viteの `/api` へのリクエストは `vite.config.ts` のproxy設定でbackendコンテナに転送されるため、backend/frontendを合わせて起動しておく
- Docker Desktop（またはDockerデーモン）が起動していない場合、以降のコマンドはすべて失敗する

## 起動コマンド

まずコンテナの状態を確認する。

```bash
docker compose ps
```

アプリは**常に同じポート**（frontend=5173 / backend=8000）で起動する。ルートCLAUDE.md「起動ポリシー」に従い、**既に起動済みでも再起動して**同一ポートのクリーンな単一インスタンスを保証する（別ポートの古いインスタンスが残るのを防ぐ）。

```bash
# --force-recreateで既存コンテナを作り直す（未起動なら通常起動と同じ）。
# ソースはvolumeマウントのためホットリロードが効き、依存関係を変更しない限り--buildは初回のみでよい。
docker compose up --build -d --force-recreate frontend backend
```

## 起動確認（テストではなく疎通確認のみ）

ポートをポーリングしてから、HTTPステータスのみ確認する。ブラウザでのスクリーンショット取得やPlaywright等によるUI操作確認は不要。

```bash
# バックエンド: OpenAPIスキーマが200で返れば起動OK
timeout 20 bash -c 'until curl -sf http://127.0.0.1:8000/openapi.json >/dev/null; do sleep 1; done'
curl -s -o /dev/null -w "backend: %{http_code}\n" http://127.0.0.1:8000/docs

# フロントエンド: トップページが200で返れば起動OK
timeout 20 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done'
curl -s -o /dev/null -w "frontend: %{http_code}\n" http://localhost:5173
```

両方 `200` が返れば「起動している」と判断してよい。起動に失敗している場合は `docker compose logs backend` / `docker compose logs frontend` で原因を確認する。

## 停止方法

停止対象のコンテナを確認してから止める（無関係なコンテナを巻き込まないため、対象サービス名を明示する）。

```bash
docker compose ps
docker compose stop frontend backend
```

停止できたか、コンテナの状態で確認する（テストではなく疎通不可の確認のみ）。

```bash
docker compose ps
```

対象サービスが `exited`/一覧から消えていれば停止完了。

## 既知の注意点

- 本スキルはコンテナのstart/stopのみを行う。イメージやコンテナ自体の削除（`docker compose down -v`等）は本スキルの対象外で、必要な場合はユーザーに確認する。
- `.env` の中身は表示・出力しない（ルートCLAUDE.mdのセキュリティ方針）。
