import { describe, expect, it, vi } from 'vitest'

// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY未設定のローカル環境相当（lib/supabaseClientがnullを返す）。
// この場合、authStoreはクラッシュせず「認証機能なし＝常に未ログイン」として振る舞う必要がある。
vi.mock('@/lib/supabaseClient', () => ({ supabase: null }))

const { useAuthStore } = await import('./authStore')

describe('useAuthStore（Supabase未設定環境）', () => {
  it('isAuthAvailableはfalseになる', () => {
    expect(useAuthStore.getState().isAuthAvailable).toBe(false)
  })

  it('signInWithPasswordを呼んでも例外を投げずsessionはnullのまま', async () => {
    await expect(
      useAuthStore.getState().signInWithPassword('a@example.com', 'password123'),
    ).resolves.toBeUndefined()
    expect(useAuthStore.getState().session).toBeNull()
  })

  it('initを呼んでも例外を投げない', () => {
    expect(() => useAuthStore.getState().init()).not.toThrow()
  })
})
