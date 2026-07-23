import { http, HttpResponse } from 'msw'
import type { components } from '@/types/api'

// テスト用の既定モックレスポンス。backend/app/main.py のモックエンドポイントが
// 返すダミーデータ（ステップ2実装）と同じ形にしておくことで、
// 実際のバックエンドと疎通した場合との挙動差を小さくする。
export const dummyRenderResponse: components['schemas']['RenderResponse'] = {
  html: '<!doctype html><html><body><p>{{dummy}}</p></body></html>',
  css: 'body { font-family: sans-serif; }',
  json: { dummy: 'sample' },
}

// ステップ5結合テストの共通ハンドラ。個別のテストで挙動を変えたい場合は
// `server.use(...)` で一時的に上書きする（例: エラーレスポンスの検証）。
export const handlers = [
  http.post('/api/render', () => {
    return HttpResponse.json(dummyRenderResponse)
  }),
  // 編集中スナップショットの保存・上書き。保存時のidは以降の上書き先として使われる。
  http.post('/api/history/edit', () =>
    HttpResponse.json({ id: 'edit-1', kind: 'edit' }, { status: 201 }),
  ),
  http.put('/api/history/edit/:id', ({ params }) =>
    HttpResponse.json({ id: params.id, kind: 'edit' }),
  ),
  // 一覧取得は既定で空配列とし、必要なテストがserver.useで個別に上書きする。
  http.get('/api/history', () => HttpResponse.json([])),
  // App表示時のホットスタンバイ（ADR-028）。全画面テストが未処理リクエストで落ちないよう既定で持つ。
  http.post('/api/warmup', () =>
    HttpResponse.json({ docling: 'ok', pdf2htmlex: 'ok', database: 'ok' }),
  ),
]
