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

const signInWithPassword = vi.fn()
const signUpWithPassword = vi.fn()
const signOut = vi.fn()
const dismissError = vi.fn()

function setStoreState(overrides: Partial<ReturnType<typeof useAuthStore>>) {
  const state = {
    session: null,
    isAuthAvailable: true,
    error: null,
    isSubmitting: false,
    init: vi.fn(),
    signInWithPassword,
    signUpWithPassword,
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

  it('未ログイン時はログインを開く操作ボタンを表示する', () => {
    setStoreState({})

    render(<AuthPanel />)

    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument()
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

  it('ログインを開き、メールアドレス・パスワードを入力して送信するとsignInWithPasswordが呼ばれる', async () => {
    const user = userEvent.setup()
    setStoreState({})

    render(<AuthPanel />)
    await user.click(screen.getByRole('button', { name: 'ログイン' }))
    await user.type(screen.getByLabelText('メールアドレス'), 'user@example.com')
    await user.type(screen.getByLabelText('パスワード'), 'password123')
    await user.click(screen.getByRole('button', { name: 'ログイン', hidden: false }))

    expect(signInWithPassword).toHaveBeenCalledWith('user@example.com', 'password123')
  })

  it('新規登録ボタンを押すとsignUpWithPasswordが呼ばれる', async () => {
    const user = userEvent.setup()
    setStoreState({})

    render(<AuthPanel />)
    await user.click(screen.getByRole('button', { name: 'ログイン' }))
    await user.type(screen.getByLabelText('メールアドレス'), 'user@example.com')
    await user.type(screen.getByLabelText('パスワード'), 'password123')
    await user.click(screen.getByRole('button', { name: '新規登録' }))

    expect(signUpWithPassword).toHaveBeenCalledWith('user@example.com', 'password123')
  })

  it('errorが設定されている場合、エラーメッセージを表示する', async () => {
    const user = userEvent.setup()
    setStoreState({ error: 'Invalid login credentials' })

    render(<AuthPanel />)
    await user.click(screen.getByRole('button', { name: 'ログイン' }))

    expect(screen.getByText('Invalid login credentials')).toBeInTheDocument()
  })
})
