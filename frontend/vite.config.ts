/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // tsconfig.app.json / tsconfig.json の paths 設定と一致させる。
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Viteの既定は127.0.0.1のみへのbindだが、コンテナ外（ホストPC）からアクセスするため
    // 全interfaceでlistenする（ADR-014）。
    host: true,
    // ポートを固定し、5173が使用中でも別ポートへ自動退避させない。自動退避を許すと
    // 「コンテナが公開している5173に実アプリが居ない」というポートずれが起き、
    // ユーザーが古いインスタンスを見てしまう事故につながる。
    port: 5173,
    strictPort: true,
    // e2eサービスはサービス名`frontend`で疎通するためHostヘッダーが`frontend:5173`となり、
    // Viteの既定のホスト検証（DNSリバインディング対策）では403になる。
    allowedHosts: ['frontend'],
    proxy: {
      // api.tsは相対パスで/api/renderを叩くため、プロキシがないとVite自身に届いて疎通しない。
      '/api': 'http://backend:8000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Playwrightのe2eはブラウザ実行前提でVitest（jsdom）では動かないため収集対象から外す。
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
})
