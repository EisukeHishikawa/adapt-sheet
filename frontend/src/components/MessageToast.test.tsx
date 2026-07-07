import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageToast } from './MessageToast'
import { useSheetStore } from '@/store/sheetStore'

// ステップ8: docs/spec.md 2.2「インテリジェントメッセージ表示」のUI。
// ストアのerror/successMessageをトーストとして表示し、閉じられることを検証する。
describe('MessageToast（メッセージ表示）', () => {
  beforeEach(() => {
    useSheetStore.setState({ error: null, successMessage: null })
  })

  it('error/successMessageがどちらもnullのときは何も表示しない', () => {
    render(<MessageToast />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('エラーメッセージをrole="alert"で表示する', () => {
    useSheetStore.setState({ error: 'サーバーで想定外のエラーが発生しました。' })
    render(<MessageToast />)

    expect(screen.getByRole('alert')).toHaveTextContent('サーバーで想定外のエラーが発生しました。')
  })

  it('成功メッセージをrole="status"で表示する', () => {
    useSheetStore.setState({ successMessage: '描画が完了しました' })
    render(<MessageToast />)

    expect(screen.getByRole('status')).toHaveTextContent('描画が完了しました')
  })

  it('閉じるボタンでエラーメッセージを消せる', async () => {
    useSheetStore.setState({ error: 'サーバーで想定外のエラーが発生しました。' })
    const user = userEvent.setup()
    render(<MessageToast />)

    await user.click(screen.getByRole('button', { name: 'メッセージを閉じる' }))

    expect(useSheetStore.getState().error).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
