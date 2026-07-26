import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWarmupBackendServices = vi.fn()
const mockPingSupabase = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/warmup', () => ({
  warmupBackendServices: mockWarmupBackendServices,
  pingSupabase: mockPingSupabase,
}))

const { useWarmupStore } = await import('./warmupStore')

beforeEach(() => {
  vi.clearAllMocks()
  useWarmupStore.setState({ status: 'pending' })
})

describe('useWarmupStore', () => {
  it('doclingがokを返した時点でreadyになり、それ以上リトライしない', async () => {
    mockWarmupBackendServices.mockResolvedValue({ docling: 'ok', pdf2htmlex: 'ok', database: 'ok' })

    await useWarmupStore.getState().run()

    expect(useWarmupStore.getState().status).toBe('ready')
    expect(mockWarmupBackendServices).toHaveBeenCalledTimes(1)
  })

  it('doclingがunavailableのままリトライ上限に達すると、unavailableとして操作可能にする', async () => {
    vi.useFakeTimers()
    mockWarmupBackendServices.mockResolvedValue({ docling: 'unavailable', pdf2htmlex: 'ok', database: 'ok' })

    const runPromise = useWarmupStore.getState().run()
    // 5回のリトライ待機（各5秒）をすべて進める。
    for (let i = 0; i < 5; i += 1) {
      await vi.advanceTimersByTimeAsync(5000)
    }
    await runPromise

    expect(useWarmupStore.getState().status).toBe('unavailable')
    expect(mockWarmupBackendServices).toHaveBeenCalledTimes(6)
    vi.useRealTimers()
  })

  it('待っている間はpendingのまま', async () => {
    vi.useFakeTimers()
    mockWarmupBackendServices.mockResolvedValue({ docling: 'unavailable', pdf2htmlex: 'ok', database: 'ok' })

    const runPromise = useWarmupStore.getState().run()
    await Promise.resolve()

    expect(useWarmupStore.getState().status).toBe('pending')

    await vi.advanceTimersByTimeAsync(5000 * 5)
    await runPromise
    vi.useRealTimers()
  })
})
