import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { useSheetStore } from '@/store/sheetStore'

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
