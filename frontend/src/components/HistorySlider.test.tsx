import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HistorySlider } from './HistorySlider'
import { useSheetStore } from '@/store/sheetStore'
import type { HistoryEntry } from '@/store/sheetStore'

// ステップ8: docs/spec.md 2.2「履歴スライド機能」のUI。
// 「履歴が横に並んで表示される」「クリックで過去の描画内容をプレビューに復元できる」を検証する。
function makeEntry(label: string): HistoryEntry {
  return {
    html: `<p>${label}</p>`,
    css: `/* ${label} */`,
    json: { label },
    widthMm: 210,
    heightMm: 297,
  }
}

describe('HistorySlider（履歴スライド機能）', () => {
  beforeEach(() => {
    useSheetStore.setState({ history: [], htmlContent: '', cssContent: '', jsonContent: {} })
  })

  it('履歴が空のときは何も表示しない（プレースホルダのみ）', () => {
    render(<HistorySlider />)
    expect(screen.queryByRole('button', { name: /履歴/ })).not.toBeInTheDocument()
  })

  it('履歴の件数ぶんのサムネイルが新しい順に並ぶ', () => {
    useSheetStore.setState({ history: [makeEntry('new'), makeEntry('old')] })
    render(<HistorySlider />)

    const items = screen.getAllByRole('button', { name: /履歴/ })
    expect(items).toHaveLength(2)
    // aria-labelに順序が入る想定（1件目＝最新）
    expect(items[0]).toHaveAccessibleName('履歴 1')
    expect(items[1]).toHaveAccessibleName('履歴 2')
  })

  it('履歴サムネイルをクリックすると、その内容がプレビュー（ストア）へ復元される', async () => {
    useSheetStore.setState({ history: [makeEntry('new'), makeEntry('old')] })
    const user = userEvent.setup()
    render(<HistorySlider />)

    await user.click(screen.getByRole('button', { name: '履歴 2' }))

    expect(useSheetStore.getState().htmlContent).toBe('<p>old</p>')
    expect(useSheetStore.getState().cssContent).toBe('/* old */')
    expect(useSheetStore.getState().jsonContent).toEqual({ label: 'old' })
  })
})
