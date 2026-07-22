import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthPanel } from './AuthPanel'
import { useAuthStore } from '@/store/authStore'

// authStoreはSupabase SDKを直接叩くため（authStore.test.ts側で検証済み）、ここではストアを
// モックし、AuthPanelがストアの状態・アクションを正しく橋渡しすることだけを検証する。
vi.mock('@/store/authStore', () => ({
  useAuthStore: vi.fn(),
}))

const mockedUseAuthStore = vi.mocked(useAuthStore)

const signInWithGoogle = vi.fn()
const signOut = vi.fn()
const dismissError = vi.fn()

function setStoreState(overrides: Partial<ReturnType<typeof useAuthStore>>) {
  const state = {
    session: null,
    isAuthAvailable: true,
    isInitializing: false,
    error: null,
    isSubmitting: false,
    init: vi.fn(),
    signInWithGoogle,
    signOut,
    dismissError,
    ...overrides,
  }
  mockedUseAuthStore.mockImplementation((selector) => selector(state as never))
}

describe('AuthPanel（DEVELOPMENT.md ステップ27）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isAuthAvailableがfalseの場合、何も表示しない', () => {
    setStoreState({ isAuthAvailable: false })

    const { container } = render(<AuthPanel />)

    expect(container).toBeEmptyDOMElement()
  })

  it('未ログイン時はGoogleログインボタンだけを表示する', () => {
    setStoreState({})

    render(<AuthPanel />)

    expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeInTheDocument()
  })

  it('ログイン済みの場合、メールアドレスとログアウトボタンを表示する', () => {
    setStoreState({ session: { user: { email: 'user@example.com' } } as never })

    render(<AuthPanel />)

    expect(screen.getByText('user@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
  })

  it('ログアウトボタンを押すとsignOutが呼ばれる', async () => {
    const user = userEvent.setup()
    setStoreState({ session: { user: { email: 'user@example.com' } } as never })

    render(<AuthPanel />)
    await user.click(screen.getByRole('button', { name: 'ログアウト' }))

    expect(signOut).toHaveBeenCalledTimes(1)
  })

  // ログイン手段はGoogleのみのため、メールアドレス・パスワードの入力欄自体を持たない（ADR-022）。
  it('メールアドレス・パスワードの入力欄を表示しない', () => {
    setStoreState({})

    render(<AuthPanel />)

    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument()
  })

  // アカウント作成は管理者のコマンド操作のみに限定したため、画面には新規登録の導線を出さない（ADR-021）。
  it('新規登録ボタンを表示しない', () => {
    setStoreState({})

    render(<AuthPanel />)

    expect(screen.queryByRole('button', { name: '新規登録' })).not.toBeInTheDocument()
  })

  // 新規登録の導線が無い理由（管理者のみが登録できる）を利用者に明示する（ADR-021）。
  it('未ログイン時にアカウント登録が管理者のみ可能である旨を表示する', () => {
    setStoreState({})

    render(<AuthPanel />)

    expect(screen.getByText('アカウント登録はシステム管理者のみ可能です')).toBeInTheDocument()
  })

  // ログイン済みの利用者には登録方法の注記は不要なため表示しない。
  it('ログイン済みの場合はアカウント登録の注記を表示しない', () => {
    setStoreState({ session: { user: { email: 'user@example.com' } } as never })

    render(<AuthPanel />)

    expect(screen.queryByText('アカウント登録はシステム管理者のみ可能です')).not.toBeInTheDocument()
  })

  it('Googleでログインボタンを押すとsignInWithGoogleが呼ばれる', async () => {
    const user = userEvent.setup()
    setStoreState({})

    render(<AuthPanel />)
    await user.click(screen.getByRole('button', { name: 'Googleでログイン' }))

    expect(signInWithGoogle).toHaveBeenCalledTimes(1)
  })

  // 復元前に未ログイン表示を描くと、直後にログイン済み表示へ入れ替わってチラつく。
  it('セッション復元中はログインボタンを表示しない', () => {
    setStoreState({ isInitializing: true })

    render(<AuthPanel />)

    expect(screen.queryByRole('button', { name: 'Googleでログイン' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
  })

  it('errorが設定されている場合、エラーメッセージを表示する', () => {
    setStoreState({ error: 'Provider is not enabled' })

    render(<AuthPanel />)

    expect(screen.getByText('Provider is not enabled')).toBeInTheDocument()
  })
})
