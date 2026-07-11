import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PromptInput } from './PromptInput'
import { useSheetStore } from '@/store/sheetStore'

// ステップ18: EditorPanelから分離したプロンプト入力欄の検証。
// 見出しは非表示にしプレースホルダで用途を示す方針のため、プレースホルダ文言と
// ストア連動（promptContent更新）を固定する。
describe('PromptInput（プロンプト入力・左カラム）', () => {
  beforeEach(() => {
    useSheetStore.setState({ promptContent: '' })
  })

  it('プロンプト入力欄に入力すると、ストアのpromptContentが更新される', async () => {
    const user = userEvent.setup()
    render(<PromptInput />)

    const promptEditor = screen.getByRole('textbox', { name: 'プロンプト入力' })
    await user.type(promptEditor, '請求書レイアウトにして')

    expect(useSheetStore.getState().promptContent).toBe('請求書レイアウトにして')
  })

  it('プレースホルダ「プロンプトを入力してください。」が表示される', () => {
    render(<PromptInput />)

    expect(screen.getByPlaceholderText('プロンプトを入力してください。')).toBeInTheDocument()
  })

  it('プロンプトインジェクション対策として、入力は100文字までに制限される', async () => {
    const user = userEvent.setup()
    render(<PromptInput />)

    const promptEditor = screen.getByRole('textbox', { name: 'プロンプト入力' })
    await user.type(promptEditor, 'あ'.repeat(105))

    expect(useSheetStore.getState().promptContent).toHaveLength(100)
  })
})
