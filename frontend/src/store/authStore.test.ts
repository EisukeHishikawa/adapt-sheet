import { beforeEach, describe, expect, it, vi } from 'vitest'

// DEVELOPMENT.md ステップ27のTDD要件: Supabase Auth SDKを直接叩かず、認証状態（session）の
// 更新ロジックだけをストア単体として検証する（実SupabaseAPIには接続しない）。
const mockAuth = {
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: mockAuth },
}))

const { useAuthStore } = await import('./authStore')

const fakeSession = {
  access_token: 'token-abc',
  user: { id: 'user-1', email: 'a@example.com' },
} as never

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ session: null, error: null, isSubmitting: false, isInitializing: true })
  mockAuth.getSession.mockResolvedValue({ data: { session: null } })
  mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
})

describe('useAuthStore', () => {
  it('supabaseクライアントが設定されていればisAuthAvailableはtrue', () => {
    expect(useAuthStore.getState().isAuthAvailable).toBe(true)
  })

  // ログイン手段はGoogleアカウントのみとしたため、パスワードログインの口を持たない（ADR-022）。
  it('パスワードログイン用のアクションを公開しない', () => {
    expect(useAuthStore.getState()).not.toHaveProperty('signInWithPassword')
  })

  // アカウント作成は管理者のコマンド操作のみに限定したため、ストアに新規登録の口を持たせない（ADR-021）。
  it('新規登録用のアクションを公開しない', () => {
    expect(useAuthStore.getState()).not.toHaveProperty('signUpWithPassword')
  })

  it('signInWithGoogleはPKCEのOAuth認可を開始する', async () => {
    mockAuth.signInWithOAuth.mockResolvedValue({ data: {}, error: null })

    await useAuthStore.getState().signInWithGoogle()

    expect(mockAuth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    expect(useAuthStore.getState().error).toBeNull()
  })

  it('signInWithGoogleが失敗したらerrorを設定し、送信中フラグを戻す', async () => {
    mockAuth.signInWithOAuth.mockResolvedValue({ data: {}, error: { message: 'Provider is not enabled' } })

    await useAuthStore.getState().signInWithGoogle()

    expect(useAuthStore.getState().error).toBe('Provider is not enabled')
    expect(useAuthStore.getState().isSubmitting).toBe(false)
  })

  it('signOutでsessionをnullに戻す', async () => {
    useAuthStore.setState({ session: fakeSession })
    mockAuth.signOut.mockResolvedValue({ error: null })

    await useAuthStore.getState().signOut()

    expect(mockAuth.signOut).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().session).toBeNull()
  })

  it('initはgetSessionの結果をsessionへ反映する', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: fakeSession } })

    useAuthStore.getState().init()
    await vi.waitFor(() => {
      expect(useAuthStore.getState().session).toEqual(fakeSession)
    })
  })

  it('initはonAuthStateChangeを購読し、以後の変化をsessionへ反映する', () => {
    let capturedCallback: ((event: string, session: unknown) => void) | undefined
    mockAuth.onAuthStateChange.mockImplementation((callback) => {
      capturedCallback = callback
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    })

    useAuthStore.getState().init()
    capturedCallback?.('SIGNED_IN', fakeSession)

    expect(useAuthStore.getState().session).toEqual(fakeSession)
  })

  // セッション復元が終わる前にログインUIを描くとチラつくため、確定するまでisInitializingで抑止する。
  it('initはセッション復元の完了後にisInitializingをfalseにする', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: fakeSession } })

    expect(useAuthStore.getState().isInitializing).toBe(true)
    useAuthStore.getState().init()

    await vi.waitFor(() => {
      expect(useAuthStore.getState().isInitializing).toBe(false)
    })
  })

  it('セッション復元に失敗してもisInitializingはfalseに戻る（UIが復元待ちのまま固まらない）', async () => {
    mockAuth.getSession.mockRejectedValue(new Error('network error'))

    useAuthStore.getState().init()

    await vi.waitFor(() => {
      expect(useAuthStore.getState().isInitializing).toBe(false)
    })
  })

  it('initが返す解除関数を呼ぶとonAuthStateChangeの購読を解除する', () => {
    const unsubscribe = vi.fn()
    mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })

    const cleanup = useAuthStore.getState().init()
    cleanup()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
