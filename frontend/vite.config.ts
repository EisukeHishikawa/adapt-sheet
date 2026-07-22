/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// XSSでアクセストークン（sessionStorage）を盗まれる経路を狭めるCSP（ADR-021）。開発サーバーは
// React Fast Refreshのインラインscriptとwebsocket(HMR)を使うため同じポリシーでは動かず、
// ビルド成果物にのみ注入する。本番配信時はCloudFront側の応答ヘッダーで同等のCSPを付けるのが
// 本筋で（metaタグはframe-ancestors等を解釈できない）、これはその二重化。
// connect-srcはSupabase（Auth/PostgREST）への接続を許可するため、ビルド時の環境変数から差し込む。
function contentSecurityPolicy(): Plugin {
  return {
    name: 'adapt-sheet-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const supabaseOrigin = process.env.VITE_SUPABASE_URL ?? ''
      const directives = [
        "default-src 'self'",
        "script-src 'self'",
        // TailwindとReactのstyle属性がインラインスタイルを使うため、styleのみ許可する。
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src 'self' ${supabaseOrigin}`.trim(),
        // プレビューはsrcdocのiframe。srcdoc文書は親のCSPを継承するため、帳票HTML内の
        // <style>を通すstyle-srcのunsafe-inlineが必要（script-srcは'self'のままなので、
        // sandbox=""と併せて生成HTML内のscriptは実行されない）。
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ]
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: directives.join('; ') },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  resolve: {
    alias: {
      // tsconfig.app.json / tsconfig.json の paths 設定と一致させる。
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Viteの既定は127.0.0.1のみへのbindだが、コンテナ外（ホストPC）からアクセスするため
    // 全interfaceでlistenする（ADR-009）。
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
