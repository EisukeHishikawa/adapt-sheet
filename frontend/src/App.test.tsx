import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import App from './App'
import { useSheetStore } from '@/store/sheetStore'
import { dummyRenderResponse } from '@/mocks/handlers'
import { server } from '@/mocks/server'
import { formatCss, formatHtml } from '@/lib/codeFormatter'

// zustandのストアはシングルトンでテスト間に状態が漏れるため、全フィールドを網羅した初期値を
// 1箇所にまとめ、フィールド追加時のリセット漏れを防ぐ。
const initialSheetState = {
  htmlContent: '',
  cssContent: '',
  jsonContent: '',
  promptContent: '',
  pdfFile: null,
  pdfFileName: null,
  // setStateは浅いマージのため、ここに列挙しないとhistory等が前テストの値のまま残る。
  widthMm: null,
  heightMm: null,
  // リセット漏れ防止のため初期値を明示する。
  engine: 'gemini_free' as const,
  history: [],
  // 履歴の通し番号カウンタ。リセット漏れ防止のため初期値を明示する。
  historySeq: 0,
  isLoading: false,
  error: null,
  successMessage: null,
}

describe('App（2カラム最小画面）', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
  })

  it('左の入力エディタに文字を入力すると、右のプレビューiframeに即座に反映される', async () => {
    const user = userEvent.setup()
    render(<App />)

    const editor = screen.getByRole('textbox', { name: 'HTML入力' })
    const preview = screen.getByTitle('プレビュー') as HTMLIFrameElement

    await user.type(editor, 'Hello')

    expect(preview.srcdoc).toBe('Hello')
  })

  it('ストアの値を直接更新した場合も、プレビューiframeのsrcDocが切り替わる', () => {
    render(<App />)

    // コンポーネントの外（テストコード）からストアを更新するため、
    // Reactの状態更新をactでラップしてDOMへの反映を待ってから検証する。
    act(() => {
      useSheetStore.getState().setHtmlContent('<p>更新後</p>')
    })

    const preview = screen.getByTitle('プレビュー') as HTMLIFrameElement
    expect(preview.srcdoc).toBe('<p>更新後</p>')
  })

  // HTMLのテンプレート変数がJSONの値で置換され、JSONを編集するとプレビューが即時に
  // 追従することを検証する。
  it('JSON入力を編集すると、HTMLのテンプレート変数が置換されてプレビューにリアルタイム反映される', () => {
    render(<App />)

    // 描画結果を模したHTML（固定テキスト＋テンプレート変数）とJSONをストアへ直接投入する。
    act(() => {
      useSheetStore.getState().setHtmlContent('<h1>帳票タイトル</h1><p>{{customer_name}}</p>')
      useSheetStore.getState().setJsonContent(JSON.stringify({ customer_name: 'モック太郎' }))
    })

    const preview = screen.getByTitle('プレビュー') as HTMLIFrameElement
    // {{customer_name}} が消え、JSONの値（モック太郎）に置換されている。
    expect(preview.srcdoc).toContain('モック太郎')
    expect(preview.srcdoc).not.toContain('{{customer_name}}')

    // JSONだけを書き換えると、再描画(API)を挟まずにプレビューが追従する。
    act(() => {
      useSheetStore.getState().setJsonContent(JSON.stringify({ customer_name: '山田花子' }))
    })
    expect(preview.srcdoc).toContain('山田花子')
    expect(preview.srcdoc).not.toContain('モック太郎')
  })
})

// MSW（frontend/src/mocks）でバックエンドの/api/renderをモックして検証する。
describe('描画ボタン押下時のAPI疎通', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
  })

  it('描画ボタンを押すと/api/renderのレスポンスがストアに格納され、プレビューに反映される', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '描画' }))

    const preview = screen.getByTitle('プレビュー') as HTMLIFrameElement
    // srcDocには置換後のHTML（{{dummy}}がsampleになったもの）とcssが含まれる。
    // htmlContent/cssContentは履歴へ積む時点で自動整形される。
    const expectedRenderedHtml = formatHtml(dummyRenderResponse.html).replace('{{dummy}}', 'sample')
    await waitFor(() => {
      expect(preview.srcdoc).toContain(expectedRenderedHtml)
      expect(preview.srcdoc).not.toContain('{{dummy}}')
      expect(preview.srcdoc).toContain(formatCss(dummyRenderResponse.css))
    })
    expect(useSheetStore.getState().cssContent).toBe(formatCss(dummyRenderResponse.css))
    // jsonContentはJSON入力エディタへ戻せる整形済みテキストとして保持する。
    expect(useSheetStore.getState().jsonContent).toBe(JSON.stringify(dummyRenderResponse.json, null, 2))
    expect(useSheetStore.getState().error).toBeNull()
  })

  it('APIがエラーを返した場合はエラーメッセージが表示され、ストアの内容は変更されない', async () => {
    // 既定engine（hybrid）は非同期ジョブ経路のため、ジョブ起動側を500エラーに差し替える。
    server.use(http.post('/api/render/jobs', () => new HttpResponse(null, { status: 500 })))

    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '描画' }))

    // エラー文言はステータスコードに対応するユーザー向けメッセージに丸められる。
    expect(await screen.findByRole('alert')).toHaveTextContent('サーバーで想定外のエラーが発生しました。')
    expect(useSheetStore.getState().htmlContent).toBe('')
  })
})

// pdfフィールドの検証は、MSWがFile入りFormDataをエンコードできない既知の制約のため
// lib/api.test.tsに委ね、ここではUIの流れ（ドロップ→描画→反映）のみ確認する。
describe('PDFアップロード時のAPI疎通', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
  })

  it('PDFをドロップしてから描画すると、ファイル名が表示され正常に描画結果が反映される', async () => {
    const user = userEvent.setup()
    render(<App />)

    const file = new File(['%PDF-1.4 dummy'], 'invoice.pdf', { type: 'application/pdf' })
    const dropzone = screen.getByLabelText('PDFドラッグ＆ドロップエリア')
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } })

    expect(screen.getByText('invoice.pdf')).toBeInTheDocument()
    expect(useSheetStore.getState().pdfFile).toBe(file)

    await user.click(screen.getByRole('button', { name: '描画' }))

    const preview = screen.getByTitle('プレビュー') as HTMLIFrameElement
    // 上と同様、テンプレート変数 {{dummy}} はJSON値（sample）へ置換されて反映される。
    await waitFor(() => {
      expect(preview.srcdoc).toContain(formatHtml(dummyRenderResponse.html).replace('{{dummy}}', 'sample'))
    })
    expect(useSheetStore.getState().error).toBeNull()
  })
})

// ネットワーク（msw）のタイミングに依存させず、ストアのisLoadingを直接操作して
// RenderButton（useElapsedSeconds）の表示ロジックのみを検証する。
describe('描画中の経過秒数表示', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('isLoading中は1秒ごとに経過秒数が描画ボタンに表示され、falseに戻ると次回のためにリセットされる', () => {
    render(<App />)

    act(() => {
      useSheetStore.setState({ isLoading: true })
    })
    expect(screen.getByRole('button', { name: /描画中/ })).toHaveTextContent('描画中...(0秒)')

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByRole('button', { name: /描画中/ })).toHaveTextContent('描画中...(1秒)')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('button', { name: /描画中/ })).toHaveTextContent('描画中...(3秒)')

    act(() => {
      useSheetStore.setState({ isLoading: false })
    })
    expect(screen.getByRole('button', { name: '描画' })).toBeInTheDocument()

    // 次に再び描画中になったとき、前回の秒数(3秒)からではなく0秒から数え直す。
    act(() => {
      useSheetStore.setState({ isLoading: true })
    })
    expect(screen.getByRole('button', { name: /描画中/ })).toHaveTextContent('描画中...(0秒)')
  })

  // 拡大表示中もRenderButtonはdisplay:contentsで見た目だけ隠してマウントし続けるため、
  // 経過秒数のstateは拡大/縮小をまたいでも保持されることを検証する。
  it('描画中にプレビューを拡大→縮小しても、経過秒数はリセットされない', () => {
    render(<App />)

    act(() => {
      useSheetStore.setState({ isLoading: true })
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('button', { name: /描画中/ })).toHaveTextContent('描画中...(2秒)')

    fireEvent.click(screen.getByRole('button', { name: 'プレビューを拡大' }))

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    // 縮小して戻すと、拡大表示中も進み続けていた秒数（2+3=5秒）がそのまま表示される。
    fireEvent.click(screen.getByRole('button', { name: 'プレビューを縮小' }))
    expect(screen.getByRole('button', { name: /描画中/ })).toHaveTextContent('描画中...(5秒)')
  })
})

// 画面を開いた時点でLambda・Supabaseを起こしておく。
describe('App（ホットスタンバイ）', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
  })

  it('マウント時に POST /api/warmup を投げる', async () => {
    const calls: string[] = []
    server.use(
      http.post('/api/warmup', () => {
        calls.push('warmup')
        return HttpResponse.json({ docling: 'ok', pdf2htmlex: 'ok', database: 'ok' })
      }),
    )

    render(<App />)

    await waitFor(() => expect(calls).toEqual(['warmup']))
  })
})
