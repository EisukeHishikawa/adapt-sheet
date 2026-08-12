import { HttpResponse, http } from 'msw'
import type { components } from '@/types/api'

// テスト用の既定モックレスポンス。backend/app/main.pyのモックエンドポイントが返すダミーデータと
// 同じ形にしておくことで、実際のバックエンドと疎通した場合との挙動差を小さくする。
export const dummyRenderResponse: components['schemas']['RenderResponse'] = {
  html: '<!doctype html><html><body><p>{{dummy}}</p></body></html>',
  css: 'body { font-family: sans-serif; }',
  json: { dummy: 'sample' },
}

// 生成AIエンジンの非同期ジョブ用の既定モック。job_idは固定で、GET /api/render/jobs/:id は
// 即座にstatus=doneを返す（ポーリングの遅延自体を検証したいテストのみserver.useで上書きする）。
const DUMMY_UPLOAD_URL = 'https://example.com/uploads/job-1.pdf'

// 結合テストの共通ハンドラ。個別のテストで挙動を変えたい場合は
// `server.use(...)` で一時的に上書きする（例: エラーレスポンスの検証）。
export const handlers = [
  http.post('/api/render', () => {
    return HttpResponse.json(dummyRenderResponse)
  }),
  http.post('/api/render/upload-url', () => HttpResponse.json({ job_id: 'job-1', upload_url: DUMMY_UPLOAD_URL })),
  http.put(DUMMY_UPLOAD_URL, () => new HttpResponse(null, { status: 200 })),
  http.post('/api/render/jobs', () => HttpResponse.json({ job_id: 'job-1' }, { status: 202 })),
  http.get('/api/render/jobs/:jobId', () => HttpResponse.json({ status: 'done', ...dummyRenderResponse })),
  // 編集中スナップショットの保存・上書き。保存時のidは以降の上書き先として使われる。
  http.post('/api/history/edit', () => HttpResponse.json({ id: 'edit-1', kind: 'edit' }, { status: 201 })),
  http.put('/api/history/edit/:id', ({ params }) => HttpResponse.json({ id: params.id, kind: 'edit' })),
  // 一覧取得は既定で空配列とし、必要なテストがserver.useで個別に上書きする。
  http.get('/api/history', () => HttpResponse.json([])),
  // gemini_free（無料枠）の当日利用回数。必要なテストがserver.useで個別に上書きする。
  http.get('/api/usage/gemini-free', () => HttpResponse.json({ date: '2026-01-01', count: 3, limit: 10 })),
  // App表示時のホットスタンバイ。全画面テストが未処理リクエストで落ちないよう既定で持つ。
  http.post('/api/warmup', () => HttpResponse.json({ docling: 'ok', pdf2htmlex: 'ok', database: 'ok' })),
]
