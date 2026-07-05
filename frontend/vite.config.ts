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
  test: {
    // DOM APIを使うコンポーネントテストのためjsdom環境を使用
    environment: 'jsdom',
    // describe/it/expect等をimportなしで使えるようにする（Vitest標準の簡易設定）
    globals: true,
    // jest-domのカスタムマッチャ（toBeInTheDocument等）を各テスト実行前に読み込む
    setupFiles: ['./src/test/setup.ts'],
  },
})
