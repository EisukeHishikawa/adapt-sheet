import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { HistoryArchive } from './HistoryArchive'
import { useAuthStore } from '@/store/authStore'
import { useSheetStore } from '@/store/sheetStore'
import { server } from '@/mocks/server'

const initialAuthState = {
  session: null,
  isAuthAvailable: false,
  isInitializing: false,
  error: null,
  isSubmitting: false,
}

// ユーザー要件「過去データの見れる機能を追加してください」のTDD:
// HistorySlider（最大10件）の枠外にある過去データを、ボタン押下でGET /api/historyから
// 取り直して一覧表示し、選んだ内容をエディタへ復元できることを検証する。
describe('HistoryArchive（過去データを見る機能）', () => {
  beforeEach(() => {
    useAuthStore.setState(initialAuthState)
    useSheetStore.setState({
      htmlContent: '',
      cssContent: '',
      jsonContent: '',
      activeEditSeq: null,
    })
  })

  it('未ログイン・認証機能が無い環境では何も表示しない（GET /api/historyはログイン必須のため）', () => {
    render(<HistoryArchive />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('ログイン済みの場合、「過去データを見る」ボタンを押すと一覧が表示される', async () => {
    useAuthStore.setState({ isAuthAvailable: true, session: { access_token: 'token-xyz' } as never })
    server.use(
      http.get('/api/history', () =>
        HttpResponse.json([
          {
            id: 'old-1',
            engine: 'gemini_free',
            html: '<p>old</p>',
            css: '',
            json: { label: 'old' },
            width_mm: null,
            height_mm: null,
            kind: 'render',
            created_at: '2026-01-01T00:00:00Z',
          },
        ]),
      ),
    )
    const user = userEvent.setup()
    render(<HistoryArchive />)

    await user.click(screen.getByRole('button', { name: '過去データを見る' }))

    expect(await screen.findByRole('button', { name: /2026/ })).toBeInTheDocument()
  })

  it('保存された履歴が無い場合は、その旨のメッセージを表示する', async () => {
    useAuthStore.setState({ isAuthAvailable: true, session: { access_token: 'token-xyz' } as never })
    server.use(http.get('/api/history', () => HttpResponse.json([])))
    const user = userEvent.setup()
    render(<HistoryArchive />)

    await user.click(screen.getByRole('button', { name: '過去データを見る' }))

    expect(await screen.findByText('保存された履歴はまだありません。')).toBeInTheDocument()
  })

  it('取得に失敗した場合はエラーメッセージを表示する', async () => {
    useAuthStore.setState({ isAuthAvailable: true, session: { access_token: 'token-xyz' } as never })
    server.use(http.get('/api/history', () => new HttpResponse(null, { status: 500 })))
    const user = userEvent.setup()
    render(<HistoryArchive />)

    await user.click(screen.getByRole('button', { name: '過去データを見る' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('過去データの取得に失敗しました。')
  })

  it('一覧から項目を選ぶと、その内容がエディタ（ストア）へ復元されダイアログが閉じる', async () => {
    useAuthStore.setState({ isAuthAvailable: true, session: { access_token: 'token-xyz' } as never })
    server.use(
      http.get('/api/history', () =>
        HttpResponse.json([
          {
            id: 'old-1',
            engine: 'gemini_free',
            html: '<p>old</p>',
            css: '/* old */',
            json: { label: 'old' },
            width_mm: 210,
            height_mm: 297,
            kind: 'render',
            created_at: '2026-01-01T00:00:00Z',
          },
        ]),
      ),
    )
    const user = userEvent.setup()
    render(<HistoryArchive />)

    await user.click(screen.getByRole('button', { name: '過去データを見る' }))
    const row = await screen.findByRole('button', { name: /2026/ })
    await user.click(row)

    expect(useSheetStore.getState().htmlContent).toBe('<p>old</p>')
    expect(useSheetStore.getState().jsonContent).toBe(JSON.stringify({ label: 'old' }, null, 2))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /2026/ })).not.toBeInTheDocument()
    })
  })
})
