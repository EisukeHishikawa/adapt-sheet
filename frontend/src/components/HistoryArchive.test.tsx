import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { server } from '@/mocks/server'
import { useAuthStore } from '@/store/authStore'
import { useSheetStore } from '@/store/sheetStore'
import { HistoryArchive } from './HistoryArchive'

const initialAuthState = {
  session: null,
  isAuthAvailable: false,
  isInitializing: false,
  error: null,
  isSubmitting: false,
}

const historyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'old-1',
  engine: 'gemini_free',
  html: '<p>old</p>',
  css: '',
  json: { label: 'old' },
  width_mm: null,
  height_mm: null,
  kind: 'render',
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

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

    expect(await screen.findByRole('button', { name: /2026.*描画結果/ })).toBeInTheDocument()
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

  // 履歴が増えても全件を読まないための絞り込み（サーバー側検索）と、1ページずつの追加取得。
  it('検索欄に入力すると、キーワード付きでサーバーへ取り直す', async () => {
    useAuthStore.setState({ isAuthAvailable: true, session: { access_token: 'token-xyz' } as never })
    const requestedUrls: string[] = []
    server.use(
      http.get('/api/history', ({ request }) => {
        requestedUrls.push(request.url)
        return HttpResponse.json([historyRow({ id: 'hit-1', created_at: '2026-03-03T00:00:00Z' })])
      }),
    )
    const user = userEvent.setup()
    render(<HistoryArchive />)

    await user.click(screen.getByRole('button', { name: '過去データを見る' }))
    await user.type(await screen.findByRole('searchbox', { name: '過去データを検索' }), '請求')

    await waitFor(() => {
      expect(requestedUrls.some((url) => new URL(url).searchParams.get('q') === '請求')).toBe(true)
    })
    // 打鍵ごとに叩かない（デバウンス）。「請」「請求」で2回にはならず、最後の1回だけ増える。
    expect(requestedUrls).toHaveLength(2)
  })

  it('種類の絞り込みを選ぶと、kind付きでサーバーへ取り直す', async () => {
    useAuthStore.setState({ isAuthAvailable: true, session: { access_token: 'token-xyz' } as never })
    const requestedUrls: string[] = []
    server.use(
      http.get('/api/history', ({ request }) => {
        requestedUrls.push(request.url)
        return HttpResponse.json([])
      }),
    )
    const user = userEvent.setup()
    render(<HistoryArchive />)

    await user.click(screen.getByRole('button', { name: '過去データを見る' }))
    await user.click(await screen.findByRole('button', { name: '編集中', pressed: false }))

    await waitFor(() => {
      expect(requestedUrls.some((url) => new URL(url).searchParams.get('kind') === 'edit')).toBe(true)
    })
    expect(await screen.findByText('条件に一致する履歴はありません。')).toBeInTheDocument()
  })

  it('1ページ分（20件）返ったときは「さらに読み込む」で続きを取得して追記する', async () => {
    useAuthStore.setState({ isAuthAvailable: true, session: { access_token: 'token-xyz' } as never })
    const offsets: (string | null)[] = []
    server.use(
      http.get('/api/history', ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset')
        offsets.push(offset)
        if (offset === '20') {
          return HttpResponse.json([historyRow({ id: 'next-1', created_at: '2025-12-31T00:00:00Z' })])
        }
        return HttpResponse.json(
          Array.from({ length: 20 }, (_, index) =>
            historyRow({ id: `row-${index}`, created_at: `2026-02-${String(index + 1).padStart(2, '0')}T00:00:00Z` }),
          ),
        )
      }),
    )
    const user = userEvent.setup()
    render(<HistoryArchive />)

    await user.click(screen.getByRole('button', { name: '過去データを見る' }))
    await user.click(await screen.findByRole('button', { name: 'さらに読み込む' }))

    expect(await screen.findByRole('button', { name: /2025\/12\/31.*描画結果/ })).toBeInTheDocument()
    expect(offsets).toContain('20')
    // 続きが1件だけ（1ページ未満）だったので、追加取得の導線は消える。
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'さらに読み込む' })).not.toBeInTheDocument()
    })
  })

  // ゴミ箱アイコンからの削除。誤操作で消えないよう確認を挟む。
  it('ゴミ箱を押しただけでは削除せず、確認後にサーバーから削除して一覧から消す', async () => {
    useAuthStore.setState({ isAuthAvailable: true, session: { access_token: 'token-xyz' } as never })
    const deletedIds: string[] = []
    server.use(
      http.get('/api/history', () => HttpResponse.json([historyRow({ id: 'old-1' })])),
      http.delete('/api/history/:id', ({ params }) => {
        deletedIds.push(String(params.id))
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = userEvent.setup()
    render(<HistoryArchive />)

    await user.click(screen.getByRole('button', { name: '過去データを見る' }))
    await user.click(await screen.findByRole('button', { name: /履歴を削除$/ }))
    expect(deletedIds).toEqual([])

    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /2026.*描画結果/ })).not.toBeInTheDocument()
    })
    expect(deletedIds).toEqual(['old-1'])
    expect(screen.getByText('保存された履歴はまだありません。')).toBeInTheDocument()
  })

  it('削除の確認を取消すと、削除せず一覧に残る', async () => {
    useAuthStore.setState({ isAuthAvailable: true, session: { access_token: 'token-xyz' } as never })
    server.use(http.get('/api/history', () => HttpResponse.json([historyRow({ id: 'old-1' })])))
    const user = userEvent.setup()
    render(<HistoryArchive />)

    await user.click(screen.getByRole('button', { name: '過去データを見る' }))
    await user.click(await screen.findByRole('button', { name: /履歴を削除$/ }))
    await user.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByRole('button', { name: /2026.*描画結果/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '削除する' })).not.toBeInTheDocument()
  })

  it('削除に失敗した場合はエラーメッセージを表示し、一覧から消さない', async () => {
    useAuthStore.setState({ isAuthAvailable: true, session: { access_token: 'token-xyz' } as never })
    server.use(
      http.get('/api/history', () => HttpResponse.json([historyRow({ id: 'old-1' })])),
      http.delete('/api/history/:id', () => new HttpResponse(null, { status: 500 })),
    )
    const user = userEvent.setup()
    render(<HistoryArchive />)

    await user.click(screen.getByRole('button', { name: '過去データを見る' }))
    await user.click(await screen.findByRole('button', { name: /履歴を削除$/ }))
    await user.click(screen.getByRole('button', { name: '削除する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('履歴の削除に失敗しました。')
    expect(screen.getByRole('button', { name: /2026.*描画結果/ })).toBeInTheDocument()
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
    const row = await screen.findByRole('button', { name: /2026.*描画結果/ })
    await user.click(row)

    expect(useSheetStore.getState().htmlContent).toBe('<p>old</p>')
    expect(useSheetStore.getState().jsonContent).toBe(JSON.stringify({ label: 'old' }, null, 2))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /2026.*描画結果/ })).not.toBeInTheDocument()
    })
  })
})
