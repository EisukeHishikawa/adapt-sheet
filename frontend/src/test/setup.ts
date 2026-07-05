// vite.config.tsのtest.setupFilesから読み込まれる。
// toBeInTheDocument()等のjest-domカスタムマッチャをVitestのexpectに拡張する。
import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from '@/mocks/server'

// ステップ5：全テスト共通でMSWサーバーを起動する。
// テストごとにサーバーの起動/停止を書く必要がなくなり、/api/render等の
// 実際のfetch呼び出しをネットワークに出さずに検証できる。
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
