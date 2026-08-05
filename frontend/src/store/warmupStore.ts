import { create } from 'zustand'
import { pingSupabase, warmupBackendServices } from '@/lib/warmup'

// docling-serviceのモデル構築が終わるまで描画ボタンを無効化し、利用者の最初のアップロードが
// コールドスタートを兼ねて大きく待たされることを避ける。
const MAX_ATTEMPTS = 6
const RETRY_DELAY_MS = 5000

type WarmupStatus = 'pending' | 'ready' | 'unavailable'

type WarmupState = {
  status: WarmupStatus
  run: () => Promise<void>
}

export const useWarmupStore = create<WarmupState>((set) => ({
  status: 'pending',
  run: async () => {
    void pingSupabase()

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const result = await warmupBackendServices()
      if (result?.docling === 'ok') {
        set({ status: 'ready' })
        return
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      }
    }

    // 既定回数リトライしても温まらない場合は諦めて操作可能にする。バックエンド側に
    // 問題があっても、利用者がボタンを永久に押せないままにはしない。
    set({ status: 'unavailable' })
  },
}))
