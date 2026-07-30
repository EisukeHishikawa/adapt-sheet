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

  it('CSSタブで「整形表示」を押すと1行のCSSが改行付きの読み取り専用表示に変わり、ストアのcssContentは変えない', async () => {
    const user = userEvent.setup()
    useSheetStore.setState({ cssContent: 'body { color: red; } .a { font-size: 12px; }' })
    render(<EditorPanel />)

    await user.click(screen.getByRole('tab', { name: 'CSS' }))
    await user.click(screen.getByRole('button', { name: '整形表示' }))

    const cssEditor = screen.getByRole('textbox', { name: 'CSS入力' })
    expect(cssEditor).toHaveAttribute('readonly')
    expect((cssEditor as HTMLTextAreaElement).value).toContain('\n')
    expect(useSheetStore.getState().cssContent).toBe('body { color: red; } .a { font-size: 12px; }')
  })

  it('JSONタブで「整形表示」を押すと1行のJSONが改行付きの読み取り専用表示に変わり、ストアのjsonContentは変えない', async () => {
    const user = userEvent.setup()
    useSheetStore.setState({ jsonContent: '{"a":1,"b":2}' })
    render(<EditorPanel />)

    await user.click(screen.getByRole('tab', { name: 'JSON' }))
    await user.click(screen.getByRole('button', { name: '整形表示' }))

    const jsonEditor = screen.getByRole('textbox', { name: 'JSON入力' })
    expect(jsonEditor).toHaveAttribute('readonly')
    expect((jsonEditor as HTMLTextAreaElement).value).toBe('{\n  "a": 1,\n  "b": 2\n}')
    expect(useSheetStore.getState().jsonContent).toBe('{"a":1,"b":2}')
  })

  it('タブを切り替えると整形表示の状態はリセットされる', async () => {
    const user = userEvent.setup()
    useSheetStore.setState({ htmlContent: '<div><p>a</p></div>' })
    render(<EditorPanel />)

    await user.click(screen.getByRole('button', { name: '整形表示' }))
    await user.click(screen.getByRole('tab', { name: 'CSS' }))
    await user.click(screen.getByRole('tab', { name: 'HTML' }))

    expect(screen.getByRole('textbox', { name: 'HTML入力' })).not.toHaveAttribute('readonly')
  })
})
