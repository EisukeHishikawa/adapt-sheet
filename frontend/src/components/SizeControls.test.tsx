import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SizeControls } from './SizeControls'
import { useSheetStore } from '@/store/sheetStore'

// ステップ17: docs/spec.md 2.2「定型サイズ自動入力」のUI再設計。
// 従来の「A4 たて」等6個の独立ボタンを、1つのSelect（トリガー+ドロップダウン、
// https://www.shadcn.net/ja/docs/components/select 相当）に統合する。
// ユーザーレビューでの複数回のフィードバックを反映した最終形として、
// - トリガーは選択中の紙のイラストそのもの（枠線・シェブロン等のフォーム部品的装飾は無し）
// - ドロップダウンは6択を縦一列に並べる（2列グリッドではない）
// - 「たて」「よこ」の文字・mm表記は画面上から排除し、方向は紙の縦横比のみで表現、
//   A4/B5/A5の表記のみイラストの中に描く
// - 視覚的な文字は無くてもアクセシブルネーム(aria-label)は維持する
// を検証する。順序はA4たて/A4よこ/B5たて/B5よこ/A5たて/A5よこ、初期値はA4よこ。
describe('SizeControls（1つのSelect・縦一列・紙イラストへのラベル内包）', () => {
  beforeEach(() => {
    useSheetStore.setState({ widthMm: 297, heightMm: 210 })
  })

  it('トリガーは1つのcombobox（紙のイラストそのもの）で、初期表示ではA4よこが選択されている', () => {
    render(<SizeControls />)

    const trigger = screen.getByRole('combobox', { name: 'サイズ選択：A4 よこ' })
    // 画面上の可視テキストは「A4」のみ（たて/よこ・mm表記は表示しない）
    expect(trigger).toHaveTextContent('A4')
    expect(trigger).not.toHaveTextContent('よこ')
    expect(trigger).not.toHaveTextContent('mm')
    const swatch = trigger.querySelector('[data-slot="paper-swatch"]')
    expect(swatch).toHaveAttribute('data-orientation', 'yoko')
    expect(swatch).toHaveStyle({ aspectRatio: '297 / 210' })
    expect(screen.getByLabelText('横幅 (mm)')).toHaveValue(297)
    expect(screen.getByLabelText('縦幅 (mm)')).toHaveValue(210)
  })

  it('開くとA4たて/A4よこ/B5たて/B5よこ/A5たて/A5よこの順で縦一列に選択肢が並び、たて/よこの文字・mm表記は表示されない', async () => {
    const user = userEvent.setup()
    render(<SizeControls />)

    await user.click(screen.getByRole('combobox', { name: 'サイズ選択：A4 よこ' }))

    const options = await screen.findAllByRole('option')
    const expectedNames = ['A4 たて', 'A4 よこ', 'B5 たて', 'B5 よこ', 'A5 たて', 'A5 よこ']
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual(expectedNames)
    options.forEach((option) => {
      expect(option).not.toHaveTextContent('たて')
      expect(option).not.toHaveTextContent('よこ')
      expect(option).not.toHaveTextContent('mm')
    })
  })

  it('「たて」の選択肢は縦長(幅<高さ)、「よこ」の選択肢は横長(幅>高さ)の紙イラストで方向を表現する', async () => {
    const user = userEvent.setup()
    render(<SizeControls />)

    await user.click(screen.getByRole('combobox', { name: 'サイズ選択：A4 よこ' }))

    const tateOption = await screen.findByRole('option', { name: 'A4 たて' })
    const yokoOption = screen.getByRole('option', { name: 'A4 よこ' })
    expect(tateOption.querySelector('[data-orientation="tate"]')).toHaveStyle({ aspectRatio: '210 / 297' })
    expect(yokoOption.querySelector('[data-orientation="yoko"]')).toHaveStyle({ aspectRatio: '297 / 210' })
  })

  it('「B5 たて」を選択すると幅182mm・高さ257mmが自動入力され、トリガーのイラストが切り替わる', async () => {
    const user = userEvent.setup()
    render(<SizeControls />)

    await user.click(screen.getByRole('combobox', { name: 'サイズ選択：A4 よこ' }))
    await user.click(await screen.findByRole('option', { name: 'B5 たて' }))

    expect(useSheetStore.getState().widthMm).toBe(182)
    expect(useSheetStore.getState().heightMm).toBe(257)
    const trigger = screen.getByRole('combobox', { name: 'サイズ選択：B5 たて' })
    const swatch = trigger.querySelector('[data-slot="paper-swatch"]')
    expect(swatch).toHaveAttribute('data-orientation', 'tate')
    expect(swatch).toHaveStyle({ aspectRatio: '182 / 257' })
  })

  it('幅の入力欄を手動編集するとストアのwidthMmが更新される', async () => {
    const user = userEvent.setup()
    render(<SizeControls />)

    const widthInput = screen.getByLabelText('横幅 (mm)')
    await user.clear(widthInput)
    await user.type(widthInput, '150')

    expect(useSheetStore.getState().widthMm).toBe(150)
  })

  it('幅の入力欄を空にするとストアのwidthMmがnullになる', async () => {
    const user = userEvent.setup()
    render(<SizeControls />)

    const widthInput = screen.getByLabelText('横幅 (mm)')
    await user.clear(widthInput)

    expect(useSheetStore.getState().widthMm).toBeNull()
  })

  it('手動入力でどのプリセットとも一致しないサイズにすると、トリガーのイラストはA4/B5/A5等の表記が無い無印になる', () => {
    useSheetStore.setState({ widthMm: 150, heightMm: 100 })
    render(<SizeControls />)

    const trigger = screen.getByRole('combobox', { name: 'サイズ選択' })
    expect(trigger).not.toHaveTextContent('A4')
    expect(trigger).not.toHaveTextContent('B5')
    expect(trigger).not.toHaveTextContent('A5')
    const swatch = trigger.querySelector('[data-slot="paper-swatch"]')
    // ラベルは無くても、形（縦横比）は実際に入力された150×100mmをそのまま反映する
    expect(swatch).toHaveAttribute('data-orientation', 'yoko')
    expect(swatch).toHaveStyle({ aspectRatio: '150 / 100' })
  })
})
