import { beforeEach, describe, expect, it, vi } from 'vitest'

// DEVELOPMENT.md ステップ27のTDD要件: Supabase Auth SDKを直接叩かず、認証状態（session）の
// 更新ロジックだけをストア単体として検証する（実SupabaseAPIには接続しない）。
const mockAuth = {
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
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
  useAuthStore.setState({ session: null, error: null, isSubmitting: false })
  mockAuth.getSession.mockResolvedValue({ data: { session: null } })
  mockAuth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
})

describe('useAuthStore', () => {
  it('supabaseクライアントが設定されていればisAuthAvailableはtrue', () => {
    expect(useAuthStore.getState().isAuthAvailable).toBe(true)
  })

  it('signInWithPasswordが成功したらsessionを更新する', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({ data: { session: fakeSession }, error: null })

    await useAuthStore.getState().signInWithPassword('a@example.com', 'password123')

    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@example.com',
      password: 'password123',
    })
    expect(useAuthStore.getState().session).toEqual(fakeSession)
    expect(useAuthStore.getState().error).toBeNull()
    expect(useAuthStore.getState().isSubmitting).toBe(false)
  })

  it('signInWithPasswordが失敗したらerrorを設定し、sessionは更新しない', async () => {
    mockAuth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    })

    await useAuthStore.getState().signInWithPassword('a@example.com', 'wrong-password')

    expect(useAuthStore.getState().session).toBeNull()
    expect(useAuthStore.getState().error).toBe('Invalid login credentials')
  })

  it('signUpWithPasswordが成功したらsessionを更新する', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { session: fakeSession }, error: null })

    await useAuthStore.getState().signUpWithPassword('a@example.com', 'password123')

    expect(mockAuth.signUp).toHaveBeenCalledWith({ email: 'a@example.com', password: 'password123' })
    expect(useAuthStore.getState().session).toEqual(fakeSession)
  })

  it('signUpWithPasswordが失敗したらerrorを設定する', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { session: null }, error: { message: 'User already registered' } })

    await useAuthStore.getState().signUpWithPassword('a@example.com', 'password123')

    expect(useAuthStore.getState().error).toBe('User already registered')
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
})
