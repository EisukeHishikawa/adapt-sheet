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
    // 開発はDocker Composeのfrontendコンテナ内でのみ行う（ADR-014）。frontendコンテナ外
    // （ホストPC）からアクセスする必要があるが、Viteの既定は127.0.0.1のみへのbindのため、
    // 全interfaceでlistenする必要がある。
    host: true,
    // Viteのallowed hosts制限（DNSリバインディング対策）は既定でHostヘッダーの値を検証するが、
    // Docker Compose上のe2eサービス（frontend/Dockerfile.e2e）はサービス名`frontend`で疎通する
    // ため、Hostヘッダーが`frontend:5173`となり既定では403 Forbiddenになる。e2e疎通のために
    // サービス名を明示的に許可する。
    allowedHosts: ['frontend'],
    proxy: {
      // frontend/src/lib/api.ts は相対パス`/api/render`をfetchするため、
      // プロキシがないとViteの開発サーバー自身に届いてしまい疎通しない。
      // backendコンテナへはCompose上のサービス名で疎通する（docker-compose.yml参照）。
      '/api': 'http://backend:8000',
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
