import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import App from './App'
import { useSheetStore } from '@/store/sheetStore'
import { dummyRenderResponse } from '@/mocks/handlers'
import { server } from '@/mocks/server'

// DEVELOPMENT.md ステップ4のTDD要件：
// 「Zustandのストア値を更新したら、プレビュー要素（iframe等）のテキストが切り替わる」を検証する。
// 実装（sheetStore/EditorPanel/PreviewPanel）が存在しない状態でこのテストを先に書き、
// Red状態を確認してからGreenにする。
describe('App（2カラム最小画面）', () => {
  // 各テストがストアの状態を共有してしまわないよう、初期値にリセットする。
  // zustandのストアはモジュールスコープでシングルトンのため、テスト間で状態が漏れる。
  beforeEach(() => {
    useSheetStore.setState({ htmlContent: '' })
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
})

// DEVELOPMENT.md ステップ5のTDD要件：
// 「ボタン押下時にAPIをフェッチし、ストアにデータが格納される」ことを、
// MSW（frontend/src/mocks）でバックエンドの/api/renderをモックして検証する。
describe('描画ボタン押下時のAPI疎通（ステップ5）', () => {
  beforeEach(() => {
    useSheetStore.setState({
      htmlContent: '',
      cssContent: '',
      jsonContent: {},
      isLoading: false,
      error: null,
    })
  })

  it('描画ボタンを押すと/api/renderのレスポンスがストアに格納され、プレビューに反映される', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '描画' }))

    const preview = screen.getByTitle('プレビュー') as HTMLIFrameElement
    await waitFor(() => {
      expect(preview.srcdoc).toBe(dummyRenderResponse.html)
    })
    expect(useSheetStore.getState().cssContent).toBe(dummyRenderResponse.css)
    expect(useSheetStore.getState().jsonContent).toEqual(dummyRenderResponse.json)
    expect(useSheetStore.getState().error).toBeNull()
  })

  it('APIがエラーを返した場合はエラーメッセージが表示され、ストアの内容は変更されない', async () => {
    // このテストのみ/api/renderを500エラーに差し替える（既定のダミーレスポンスは他テストに影響させない）。
    server.use(http.post('/api/render', () => new HttpResponse(null, { status: 500 })))

    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '描画' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('/api/render が失敗しました')
    expect(useSheetStore.getState().htmlContent).toBe('')
  })
})
