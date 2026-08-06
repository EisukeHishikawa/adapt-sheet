import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EngineSelect } from './EngineSelect'
import { useSheetStore } from '@/store/sheetStore'

// SizeControls.test.tsxと同じBase UI Selectのテストパターン（combobox→option）を踏襲する。
describe('EngineSelect（描画エンジン選択）', () => {
  beforeEach(() => {
    useSheetStore.setState({ engine: 'gemini_free' })
  })

  it('トリガーは初期表示でGemini API（無料枠）が選択されている', () => {
    render(<EngineSelect />)

    const trigger = screen.getByRole('combobox', { name: '生成エンジン選択：Gemini API（無料枠）' })
    expect(trigger).toHaveTextContent('Gemini API（無料枠）')
  })

  it('開くと8つの選択肢が、生成AI5種→変換エンジン3種の順で並び、それぞれ説明文を持つ', async () => {
    const user = userEvent.setup()
    render(<EngineSelect />)

    await user.click(screen.getByRole('combobox', { name: '生成エンジン選択：Gemini API（無料枠）' }))

    const options = await screen.findAllByRole('option')
    const labels = options.map((option) => option.textContent)
    expect(labels).toHaveLength(8)
    expect(labels[0]).toContain('精密復元')
    expect(labels[1]).toContain('Gemini API（無料枠）')
    expect(labels[2]).toContain('Gemini API')
    expect(labels[3]).toContain('Claude API')
    expect(labels[4]).toContain('OpenAI API')
    expect(labels[5]).toContain('Docling')
    expect(labels[6]).toContain('pdf2htmlEX')
    expect(labels[7]).toContain('PyMuPDF')
    // 各選択肢に1行の説明文が添えられている。
    expect(screen.getByText('PDFを直接読み取り、無料枠モデルで整形します')).toBeInTheDocument()
    expect(screen.getByText('PDFのレイアウトを座標付きで再現します（AIなし）')).toBeInTheDocument()
  })

  it('標準プラン・Claude・OpenAIには要ログインのロックアイコンが表示される（精密復元は無料枠のため対象外）', async () => {
    const user = userEvent.setup()
    render(<EngineSelect />)

    await user.click(screen.getByRole('combobox', { name: '生成エンジン選択：Gemini API（無料枠）' }))

    expect(screen.getAllByLabelText('要ログイン')).toHaveLength(3)
  })

  it('Doclingを選択すると、ストアのengineがdoclingに更新されトリガー表示も切り替わる', async () => {
    const user = userEvent.setup()
    render(<EngineSelect />)

    await user.click(screen.getByRole('combobox', { name: '生成エンジン選択：Gemini API（無料枠）' }))
    await user.click(await screen.findByRole('option', { name: /^Docling/ }))

    expect(useSheetStore.getState().engine).toBe('docling')
    expect(screen.getByRole('combobox', { name: '生成エンジン選択：Docling' })).toHaveTextContent('Docling')
  })

  it('ゲート対象のClaude APIも選択自体はでき、描画を押した時点でバックエンドが弾く設計のため無効化しない', async () => {
    const user = userEvent.setup()
    render(<EngineSelect />)

    await user.click(screen.getByRole('combobox', { name: '生成エンジン選択：Gemini API（無料枠）' }))
    const claudeOption = await screen.findByRole('option', { name: /^Claude API/ })
    expect(claudeOption).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(claudeOption)
    expect(useSheetStore.getState().engine).toBe('claude')
  })
})
