import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorPanel } from './EditorPanel'
import { useSheetStore } from '@/store/sheetStore'

// EditorPanelはHTML・CSS・JSON入力を「タブ切り替え」で表示する右カラム専用コンポーネント。
// ここではタブ切り替えとストア連動を検証する。
// 見出しテキストは非表示にする方針のため、検証は表示ラベルではなくtextareaのaria-labelとタブ（role=tab）に対して行う。
describe('EditorPanel（HTML/CSS/JSONタブ切り替え）', () => {
  beforeEach(() => {
    useSheetStore.setState({ htmlContent: '', cssContent: '', jsonContent: '', promptContent: '' })
  })

  it('既定ではHTMLタブが選択され、HTML入力欄のみが表示される', () => {
    render(<EditorPanel />)

    expect(screen.getByRole('textbox', { name: 'HTML入力' })).toBeInTheDocument()
    // 非表示タブのtextareaはアンマウントされるため、CSS・JSON入力欄は初期状態では存在しない。
    expect(screen.queryByRole('textbox', { name: 'CSS入力' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'JSON入力' })).not.toBeInTheDocument()
  })

  it('CSSタブに切り替えるとCSS入力欄が表示され、入力でcssContentが更新される', async () => {
    const user = userEvent.setup()
    render(<EditorPanel />)

    await user.click(screen.getByRole('tab', { name: 'CSS' }))

    const cssEditor = screen.getByRole('textbox', { name: 'CSS入力' })
    fireEvent.change(cssEditor, { target: { value: 'body { color: red; }' } })

    expect(useSheetStore.getState().cssContent).toBe('body { color: red; }')
  })

  it('JSONタブに切り替えるとJSON入力欄が表示され、入力でjsonContentが更新される', async () => {
    const user = userEvent.setup()
    render(<EditorPanel />)

    await user.click(screen.getByRole('tab', { name: 'JSON' }))

    // userEvent.typeは{}を特殊キー記法として解釈するため、JSON入力の検証では
    // fireEvent.changeで生のテキストをそのまま流し込む。
    const jsonEditor = screen.getByRole('textbox', { name: 'JSON入力' })
    fireEvent.change(jsonEditor, { target: { value: '{"a":1}' } })

    expect(useSheetStore.getState().jsonContent).toBe('{"a":1}')
  })

  it('HTMLタブで「整形表示」を押すと1行のHTMLが改行付きの読み取り専用表示に変わり、ストアのhtmlContentは変えない', async () => {
    const user = userEvent.setup()
    useSheetStore.setState({ htmlContent: '<div><p>a</p></div><div><p>b</p></div>' })
    render(<EditorPanel />)

    await user.click(screen.getByRole('button', { name: '整形表示' }))

    const htmlEditor = screen.getByRole('textbox', { name: 'HTML入力' })
    expect(htmlEditor).toHaveAttribute('readonly')
    expect((htmlEditor as HTMLTextAreaElement).value).toContain('\n')
    // 整形はソース表示だけの見た目変換であり、プレビュー描画に使うストアの値自体は変えない。
    expect(useSheetStore.getState().htmlContent).toBe('<div><p>a</p></div><div><p>b</p></div>')

    await user.click(screen.getByRole('button', { name: '編集に戻る' }))
    expect(screen.getByRole('textbox', { name: 'HTML入力' })).not.toHaveAttribute('readonly')
  })
})
