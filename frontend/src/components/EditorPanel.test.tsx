import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorPanel } from './EditorPanel'
import { useSheetStore } from '@/store/sheetStore'

// ステップ18: EditorPanelはHTML入力とJSON入力を「タブ切り替え」で表示する右カラム専用コンポーネントに
// なった（プロンプト入力は左カラムのPromptInputへ分離）。ここではタブ切り替えとストア連動、および
// CSS入力欄が存在しないこと（ADR-014）を固定する。見出しテキストは非表示にする方針のため、
// 検証は表示ラベルではなくtextareaのaria-labelとタブ（role=tab）に対して行う。
describe('EditorPanel（HTML/JSONタブ切り替え）', () => {
  beforeEach(() => {
    useSheetStore.setState({ htmlContent: '', jsonContent: '', promptContent: '' })
  })

  it('既定ではHTMLタブが選択され、HTML入力欄のみが表示される', () => {
    render(<EditorPanel />)

    expect(screen.getByRole('textbox', { name: 'HTML入力' })).toBeInTheDocument()
    // 非表示タブのtextareaはアンマウントされるため、JSON入力欄は初期状態では存在しない。
    expect(screen.queryByRole('textbox', { name: 'JSON入力' })).not.toBeInTheDocument()
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

  it('CSS入力欄は存在しない（ADR-014: CSSはHTMLの<style>に埋め込む前提のため独立エディタを持たない）', () => {
    render(<EditorPanel />)

    expect(screen.queryByRole('textbox', { name: 'CSS入力' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('CSS入力')).not.toBeInTheDocument()
  })
})
