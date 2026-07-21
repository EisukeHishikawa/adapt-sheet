import { describe, expect, it, vi } from 'vitest'

// VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY未設定のローカル環境相当（lib/supabaseClientがnullを返す）。
// この場合、authStoreはクラッシュせず「認証機能なし＝常に未ログイン」として振る舞う必要がある。
vi.mock('@/lib/supabaseClient', () => ({ supabase: null }))

const { useAuthStore } = await import('./authStore')

describe('useAuthStore（Supabase未設定環境）', () => {
  it('isAuthAvailableはfalseになる', () => {
    expect(useAuthStore.getState().isAuthAvailable).toBe(false)
  })

  it('signInWithGoogleを呼んでも例外を投げずsessionはnullのまま', async () => {
    await expect(useAuthStore.getState().signInWithGoogle()).resolves.toBeUndefined()
    expect(useAuthStore.getState().session).toBeNull()
  })

  it('initを呼んでも例外を投げず、解除関数を返す', () => {
    expect(() => useAuthStore.getState().init()()).not.toThrow()
  })

  // 認証機能が無い環境では復元を待つものが無いため、最初から確定済みとして扱う（チラつき防止の抑止が
  // かかったままAuthPanelが空になるのを防ぐ）。
  it('isInitializingはfalseのまま', () => {
    useAuthStore.getState().init()
    expect(useAuthStore.getState().isInitializing).toBe(false)
  })
})
