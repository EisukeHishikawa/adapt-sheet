import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HistorySlider } from './HistorySlider'
import { useSheetStore } from '@/store/sheetStore'
import type { HistoryItem } from '@/store/sheetStore'

// ステップ8: docs/spec.md 2.2「履歴スライド機能」のUI。
// 「履歴が横に並んで表示される」「クリックで過去の描画内容をプレビューに復元できる」を検証する。
// seqは描画ごとの通し番号（表示ラベルの基準）。大きいほど新しい描画。
function makeEntry(label: string, seq: number, kind: HistoryItem['kind'] = 'render'): HistoryItem {
  return {
    html: `<p>${label}</p>`,
    css: `/* ${label} */`,
    // ステップ16: HistoryEntry.jsonはJSON入力エディタへ戻せる生テキストとして保持する
    // （sheetStore.HistoryEntry参照）。
    json: JSON.stringify({ label }),
    widthMm: 210,
    heightMm: 297,
    seq,
    kind,
  }
}

describe('HistorySlider（履歴スライド機能）', () => {
  beforeEach(() => {
    useSheetStore.setState({ history: [], historySeq: 0, htmlContent: '', cssContent: '', jsonContent: '' })
  })

  it('履歴が空のときは何も表示しない（プレースホルダのみ）', () => {
    render(<HistorySlider />)
    expect(screen.queryByRole('button', { name: /履歴/ })).not.toBeInTheDocument()
  })

  it('履歴の件数ぶんのサムネイルが新しい順（seqの大きい順）に並び、番号は描画ごとの通し番号を表示する', () => {
    // 新しい描画ほどseqが大きい。配列は新しい順で持つため、先頭がseqの大きい方。
    useSheetStore.setState({ history: [makeEntry('new', 2), makeEntry('old', 1)] })
    render(<HistorySlider />)

    const items = screen.getAllByRole('button', { name: /履歴/ })
    expect(items).toHaveLength(2)
    // aria-labelは位置ではなく通し番号(seq)。先頭＝最新＝seqが大きい。
    expect(items[0]).toHaveAccessibleName('履歴 2')
    expect(items[1]).toHaveAccessibleName('履歴 1')
  })

  it('履歴サムネイルをクリックすると、その内容がプレビュー（ストア）へ復元される', async () => {
    useSheetStore.setState({ history: [makeEntry('new', 2), makeEntry('old', 1)] })
    const user = userEvent.setup()
    render(<HistorySlider />)

    // 「履歴 1」は通し番号1＝古い方（old）。
    await user.click(screen.getByRole('button', { name: '履歴 1' }))

    expect(useSheetStore.getState().htmlContent).toBe('<p>old</p>')
    expect(useSheetStore.getState().cssContent).toBe('/* old */')
    expect(useSheetStore.getState().jsonContent).toBe(JSON.stringify({ label: 'old' }))
  })

  // サムネイルはentry.htmlをそのまま渡すのではなく、PreviewPanelと同じrenderTemplateで
  // entry.jsonの値を{{key}}に埋め込んでから表示することを検証する。
  it('サムネイルはHTMLのテンプレート変数をJSONの値で置換した内容を表示する', () => {
    const entry: HistoryItem = {
      html: '<p>{{label}}</p>',
      css: '',
      json: JSON.stringify({ label: '請求書' }),
      widthMm: 210,
      heightMm: 297,
      seq: 1,
      kind: 'render',
    }
    useSheetStore.setState({ history: [entry] })
    render(<HistorySlider />)

    const iframe = screen.getByTitle('履歴プレビュー 1') as HTMLIFrameElement
    expect(iframe.srcdoc).toContain('請求書')
    expect(iframe.srcdoc).not.toContain('{{label}}')
  })

  // 編集中スナップショットは描画結果と同じ履歴列に並ぶが、描画を経ていないことが分かる
  // 表示（「編集中」バッジと点線枠）で区別する。
  it('kind=editの履歴は「編集中」と分かる表示になり、描画結果と同じ列に並ぶ', () => {
    useSheetStore.setState({
      history: [makeEntry('wip', 2, 'edit'), makeEntry('rendered', 1)],
    })
    render(<HistorySlider />)

    const editCard = screen.getByRole('button', { name: '編集中 2' })
    expect(editCard).toBeInTheDocument()
    expect(editCard).toHaveTextContent('編集中')
    expect(editCard.className).toContain('border-dashed')

    const renderedCard = screen.getByRole('button', { name: '履歴 1' })
    expect(renderedCard).not.toHaveTextContent('編集中')
    expect(renderedCard.className).not.toContain('border-dashed')
  })

  it('編集中の履歴もクリックでその内容へ戻せる', async () => {
    useSheetStore.setState({
      history: [makeEntry('wip', 2, 'edit'), makeEntry('rendered', 1)],
    })
    const user = userEvent.setup()
    render(<HistorySlider />)

    await user.click(screen.getByRole('button', { name: '編集中 2' }))

    expect(useSheetStore.getState().htmlContent).toBe('<p>wip</p>')
    expect(useSheetStore.getState().jsonContent).toBe(JSON.stringify({ label: 'wip' }))
  })
})
