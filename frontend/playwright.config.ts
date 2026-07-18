import { defineConfig, devices } from '@playwright/test'

// ステップ8: ブラウザ自動テスト（E2E）の設定。
// 「PDFアップロード→描画ボタン押下→履歴が横にスライドする」という一連のユーザー操作を
// 実ブラウザ（Chromium）で検証する（DEVELOPMENT.md ステップ8）。
//
// APIモック方針: /api/render は各テスト内の page.route でモックする（実バックエンド・実Claude APIには
// 接続しない。CLAUDE.md「AI呼び出しのモック」）。そのためwebServerはViteの開発サーバーのみを起動する。
//
// 実行方法（ADR-010）: frontend/Dockerfile（node:20-alpine）はPlaywrightのブラウザバイナリに
// 非対応（Alpine/musl libc）のため、E2Eはdocker-compose.ymlの独立したe2eサービス
// （mcr.microsoft.com/playwrightベース）から実行する。e2eサービスはfrontendサービス（Vite開発
// サーバー）が既に起動している前提で、PLAYWRIGHT_TEST_BASE_URLでその接続先（コンテナ間の
// サービス名 http://frontend:5173）を渡す。この環境変数が設定されている場合はwebServerによる
// 自身でのVite起動をスキップする（多重起動を避けるため）。
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  // E2EテストはVitest（src配下の*.test.tsx）と混在させないよう専用ディレクトリに隔離する。
  // vite.config.tsのtest.excludeでもこのディレクトリをVitestの対象外にしている。
  testDir: './e2e',
  // CI環境ではリトライを1回入れ、ローカルでは0回にしてフレーク検知を優先する。
  retries: process.env.CI ? 1 : 0,
  // 失敗時の原因追跡用に、初回リトライ時のみトレースを採取する。
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  // Chromiumのみを対象にする（まずはコア動作の担保を優先。必要になればfirefox/webkitを足す）。
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // テスト実行前にVite開発サーバーを自動起動する（既に起動済みなら再利用してポート衝突を避ける）。
  // PLAYWRIGHT_TEST_BASE_URL設定時（docker-compose.ymlのe2eサービスから実行時）は、
  // frontendサービスが別コンテナで既に起動しているため自身での起動は不要でありスキップする。
  webServer: process.env.PLAYWRIGHT_TEST_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
