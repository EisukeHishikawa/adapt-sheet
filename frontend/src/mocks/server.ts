import { setupServer } from 'msw/node'
import { handlers } from './handlers'

// Vitest（Node環境/jsdom）用のMSWサーバー。ブラウザのService Workerを使わず
// Node上でリクエストをインターセプトするため、CIやローカルテストでバックエンド
// プロセスを起動しなくても /api/render 疎通の結合テストが書ける。
export const server = setupServer(...handlers)
