/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // shadcn/uiのコンポーネント/ユーティリティが `@/...` で解決できるよう、
    // tsconfig.app.json / tsconfig.json の paths 設定とエイリアスを一致させる
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Docker Compose環境ではfrontendコンテナ外（ホストPC）からアクセスする必要があるが、
    // Viteの既定は127.0.0.1のみへのbindのため、コンテナ内で起動する場合は全interfaceで
    // listenする必要がある。ローカル（非Docker）実行時もhost:trueは無害なため常時有効にする。
    host: true,
    proxy: {
      // frontend/src/lib/api.ts は相対パス`/api/render`をfetchするため、
      // プロキシがないとViteの開発サーバー自身に届いてしまい疎通しない。
      // ローカル実行時はbackend（uvicorn）が8000番ポートで起動する前提のlocalhostを既定にし、
      // Docker Compose環境ではサービス名で疎通させるためBACKEND_URL（docker-compose.yml参照）で上書きする。
      '/api': process.env.BACKEND_URL ?? 'http://localhost:8000',
    },
  },
  test: {
    // DOM APIを使うコンポーネントテストのためjsdom環境を使用
    environment: 'jsdom',
    // describe/it/expect等をimportなしで使えるようにする（Vitest標準の簡易設定）
    globals: true,
    // jest-domのカスタムマッチャ（toBeInTheDocument等）を各テスト実行前に読み込む
    setupFiles: ['./src/test/setup.ts'],
    // Playwrightのe2e（e2e/*.spec.ts）はブラウザ実行前提でVitest（jsdom）では動かないため、
    // Vitestの収集対象から除外する（デフォルトのnode_modules/dist除外も維持する）。
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
})
