import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorPanel } from './EditorPanel'
import { useSheetStore } from '@/store/sheetStore'

// DEVELOPMENT.md ステップ16のTDD要件: docs/spec.md 2.1「3大入力エディタ」（HTML/JSON/プロンプト）を
// 検証する。CSS入力欄は追加しない決定（ADR-019）のため、CSS入力欄が存在しないことも合わせて固定する。
describe('EditorPanel（JSON/プロンプト入力エリアの追加・ADR-019）', () => {
  beforeEach(() => {
    useSheetStore.setState({ htmlContent: '', jsonContent: '', promptContent: '' })
  })

  it('JSON入力欄に入力すると、ストアのjsonContentが更新される', () => {
    render(<EditorPanel />)

    // userEvent.typeは{}を特殊キー記法として解釈してしまうため、JSON入力の検証では
    // fireEvent.changeで生のテキストをそのまま流し込む。
    const jsonEditor = screen.getByRole('textbox', { name: 'JSON入力' })
    fireEvent.change(jsonEditor, { target: { value: '{"a":1}' } })

    expect(useSheetStore.getState().jsonContent).toBe('{"a":1}')
  })

  it('プロンプト入力欄に入力すると、ストアのpromptContentが更新される', async () => {
    const user = userEvent.setup()
    render(<EditorPanel />)

    const promptEditor = screen.getByRole('textbox', { name: 'プロンプト入力' })
    await user.type(promptEditor, '請求書レイアウトにして')

    expect(useSheetStore.getState().promptContent).toBe('請求書レイアウトにして')
  })

  it('CSS入力欄は存在しない（ADR-019: CSSはHTMLの<style>に埋め込む前提のため独立エディタを持たない）', () => {
    render(<EditorPanel />)

    expect(screen.queryByRole('textbox', { name: 'CSS入力' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('CSS入力')).not.toBeInTheDocument()
  })
})
