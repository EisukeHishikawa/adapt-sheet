import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EngineSelect } from './EngineSelect'
import { useSheetStore } from '@/store/sheetStore'

// ADR-023: 描画エンジン（生成AI4種＋変換エンジン3種、計7つ）を選ぶSelect。
// SizeControls.test.tsxと同じBase UI Selectのテストパターン（combobox→option）を踏襲する。
describe('EngineSelect（描画エンジン選択・ADR-023）', () => {
  beforeEach(() => {
    useSheetStore.setState({ engine: 'gemini_free' })
  })

  it('トリガーは初期表示でGemini API（無料）が選択されている', () => {
    render(<EngineSelect />)

    const trigger = screen.getByRole('combobox', { name: '生成エンジン選択：Gemini API（無料）' })
    expect(trigger).toHaveTextContent('Gemini API（無料）')
  })

  it('開くと7つの選択肢が、生成AI4種→変換エンジン3種の順で並び、それぞれ説明文を持つ', async () => {
    const user = userEvent.setup()
    render(<EngineSelect />)

    await user.click(screen.getByRole('combobox', { name: '生成エンジン選択：Gemini API（無料）' }))

    const options = await screen.findAllByRole('option')
    const labels = options.map((option) => option.textContent)
    expect(labels).toHaveLength(7)
    expect(labels[0]).toContain('Gemini API（無料）')
    expect(labels[1]).toContain('Gemini API')
    expect(labels[2]).toContain('Claude API')
    expect(labels[3]).toContain('OpenAI API')
    expect(labels[4]).toContain('Docling')
    expect(labels[5]).toContain('pdf2htmlEX')
    expect(labels[6]).toContain('PyMuPDF')
    // 各選択肢に1行の説明文が添えられている。
    expect(screen.getByText('PDFを直接読み取り、無料枠モデルで整形します')).toBeInTheDocument()
    expect(screen.getByText('PDFのレイアウトを座標付きで再現します（AIなし）')).toBeInTheDocument()
  })

  it('標準プラン・Claude・OpenAIには要アカウント登録のロックアイコンが表示される', async () => {
    const user = userEvent.setup()
    render(<EngineSelect />)

    await user.click(screen.getByRole('combobox', { name: '生成エンジン選択：Gemini API（無料）' }))

    expect(screen.getAllByLabelText('要アカウント登録（フェーズ5で利用可能予定）')).toHaveLength(3)
  })

  it('Doclingを選択すると、ストアのengineがdoclingに更新されトリガー表示も切り替わる', async () => {
    const user = userEvent.setup()
    render(<EngineSelect />)

    await user.click(screen.getByRole('combobox', { name: '生成エンジン選択：Gemini API（無料）' }))
    await user.click(await screen.findByRole('option', { name: /^Docling/ }))

    expect(useSheetStore.getState().engine).toBe('docling')
    expect(screen.getByRole('combobox', { name: '生成エンジン選択：Docling' })).toHaveTextContent('Docling')
  })

  it('ゲート対象のClaude APIも選択自体はでき、描画を押した時点でバックエンドが弾く設計のため無効化しない', async () => {
    const user = userEvent.setup()
    render(<EngineSelect />)

    await user.click(screen.getByRole('combobox', { name: '生成エンジン選択：Gemini API（無料）' }))
    const claudeOption = await screen.findByRole('option', { name: /^Claude API/ })
    expect(claudeOption).not.toHaveAttribute('aria-disabled', 'true')

    await user.click(claudeOption)
    expect(useSheetStore.getState().engine).toBe('claude')
  })
})
