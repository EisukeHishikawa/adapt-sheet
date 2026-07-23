import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'

// Supabaseの疎通確認はSDK経由のため、実APIに接続せずクエリビルダーの呼び出しだけを検証する。
const mockLimit = vi.fn()
const mockSelect = vi.fn(() => ({ limit: mockLimit }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: mockFrom },
}))

const { pingSupabase, warmupBackendServices, runWarmup } = await import('./warmup')

beforeEach(() => {
  vi.clearAllMocks()
  mockLimit.mockResolvedValue({ data: [], error: null })
})

describe('warmupBackendServices', () => {
  it('POST /api/warmup を1回だけ呼ぶ', async () => {
    const calls: string[] = []
    server.use(
      http.post('/api/warmup', () => {
        calls.push('warmup')
        return HttpResponse.json({ docling: 'ok', pdf2htmlex: 'ok', database: 'ok' })
      }),
    )

    await warmupBackendServices()

    expect(calls).toEqual(['warmup'])
  })

  it('バックエンドが失敗しても例外を投げない（画面表示を妨げない）', async () => {
    server.use(http.post('/api/warmup', () => HttpResponse.error()))

    await expect(warmupBackendServices()).resolves.toBeUndefined()
  })
})

describe('pingSupabase', () => {
  it('最小のSELECTを投げてプロジェクトの一時停止を避ける', async () => {
    await pingSupabase()

    expect(mockFrom).toHaveBeenCalledWith('render_history')
    expect(mockSelect).toHaveBeenCalled()
    expect(mockLimit).toHaveBeenCalledWith(1)
  })

  it('SDKが例外を投げても呼び出し元へ伝播させない', async () => {
    mockLimit.mockRejectedValue(new Error('network down'))

    await expect(pingSupabase()).resolves.toBeUndefined()
  })
})

describe('runWarmup', () => {
  it('バックエンドとSupabaseの両方へ投げる', async () => {
    const calls: string[] = []
    server.use(
      http.post('/api/warmup', () => {
        calls.push('warmup')
        return HttpResponse.json({ docling: 'ok', pdf2htmlex: 'ok', database: 'ok' })
      }),
    )

    await runWarmup()

    expect(calls).toEqual(['warmup'])
    expect(mockFrom).toHaveBeenCalledWith('render_history')
  })
})
