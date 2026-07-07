import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SizeControls } from './SizeControls'
import { useSheetStore } from '@/store/sheetStore'

// ステップ8: docs/spec.md 2.1「コントロール」/ 2.2「定型サイズ自動入力」のUI。
// 「プリセットボタン押下でサイズが自動入力される」「幅/高さを手動編集できる」ことを検証する。
describe('SizeControls（縦幅・横幅サイズ入力）', () => {
  beforeEach(() => {
    useSheetStore.setState({ widthMm: null, heightMm: null })
  })

  it('「A4 たて」を押すと幅210mm・高さ297mmが自動入力される', async () => {
    const user = userEvent.setup()
    render(<SizeControls />)

    await user.click(screen.getByRole('button', { name: 'A4 たて' }))

    expect(useSheetStore.getState().widthMm).toBe(210)
    expect(useSheetStore.getState().heightMm).toBe(297)
    // 入力欄にも反映されること（controlled入力）
    expect(screen.getByLabelText('横幅 (mm)')).toHaveValue(210)
    expect(screen.getByLabelText('縦幅 (mm)')).toHaveValue(297)
  })

  it('「A4 よこ」を押すと幅297mm・高さ210mmが自動入力される', async () => {
    const user = userEvent.setup()
    render(<SizeControls />)

    await user.click(screen.getByRole('button', { name: 'A4 よこ' }))

    expect(useSheetStore.getState().widthMm).toBe(297)
    expect(useSheetStore.getState().heightMm).toBe(210)
  })

  it('幅の入力欄を手動編集するとストアのwidthMmが更新される', async () => {
    const user = userEvent.setup()
    render(<SizeControls />)

    const widthInput = screen.getByLabelText('横幅 (mm)')
    await user.type(widthInput, '150')

    expect(useSheetStore.getState().widthMm).toBe(150)
  })

  it('幅の入力欄を空にするとストアのwidthMmがnullになる', async () => {
    useSheetStore.setState({ widthMm: 210 })
    const user = userEvent.setup()
    render(<SizeControls />)

    const widthInput = screen.getByLabelText('横幅 (mm)')
    await user.clear(widthInput)

    expect(useSheetStore.getState().widthMm).toBeNull()
  })
})
