import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreviewPanel } from './PreviewPanel'
import { useSheetStore } from '@/store/sheetStore'

// 拡大表示（expanded）中のズーム機能（ズームイン/ズームアウト）の検証。
// jsdomはResizeObserver/clientWidth等の実測ができないため、実際のpx倍率(iframeのtransform)は
// 検証対象にせず、UIの表示切り替え・ズーム率表示・状態のリセットに絞って検証する。
describe('PreviewPanel（拡大表示中のズーム操作）', () => {
  beforeEach(() => {
    useSheetStore.setState({
      htmlContent: '<p>ok</p>',
      cssContent: 'body{}',
      jsonContent: '{}',
      widthMm: null,
      heightMm: null,
    })
  })

  it('拡大表示していないときは、ズーム操作は表示されない', () => {
    render(<PreviewPanel expanded={false} onToggleExpand={() => {}} />)

    expect(screen.queryByRole('button', { name: 'ズームイン' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ズームアウト' })).not.toBeInTheDocument()
  })

  it('拡大表示中はズーム操作が表示され、既定は100%でズームアウトが無効化されている', () => {
    render(<PreviewPanel expanded onToggleExpand={() => {}} />)

    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ズームアウト' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ズームイン' })).toBeEnabled()
  })

  it('ズームインを押すたびに倍率が上がり、ズームアウトを押すと下がる', async () => {
    const user = userEvent.setup()
    render(<PreviewPanel expanded onToggleExpand={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'ズームイン' }))
    expect(screen.getByText('125%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ズームイン' }))
    expect(screen.getByText('150%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ズームアウト' }))
    expect(screen.getByText('125%')).toBeInTheDocument()
  })

  it('ズームしてもリセットボタンは表示されず、ズームアウトで100%に戻せる', async () => {
    const user = userEvent.setup()
    render(<PreviewPanel expanded onToggleExpand={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'ズームイン' }))
    expect(screen.queryByRole('button', { name: 'ズームを既定に戻す' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'ズームアウト' }))
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ズームアウト' })).toBeDisabled()
  })

  it('300%が上限で、それ以上はズームインが無効化される', async () => {
    const user = userEvent.setup()
    render(<PreviewPanel expanded onToggleExpand={() => {}} />)

    for (let i = 0; i < 10; i += 1) {
      await user.click(screen.getByRole('button', { name: 'ズームイン' }))
    }

    expect(screen.getByText('300%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ズームイン' })).toBeDisabled()
  })

  it('ズーム操作ボタンを押しても、プレビューの拡大/縮小トグル（onToggleExpand）は発火しない', async () => {
    const user = userEvent.setup()
    const onToggleExpand = vi.fn()
    render(<PreviewPanel expanded onToggleExpand={onToggleExpand} />)

    await user.click(screen.getByRole('button', { name: 'ズームイン' }))

    expect(onToggleExpand).not.toHaveBeenCalled()
  })

  it('縮小してから再度拡大表示にすると、ズームは100%へリセットされている', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<PreviewPanel expanded onToggleExpand={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'ズームイン' }))
    expect(screen.getByText('125%')).toBeInTheDocument()

    rerender(<PreviewPanel expanded={false} onToggleExpand={() => {}} />)
    rerender(<PreviewPanel expanded onToggleExpand={() => {}} />)

    expect(screen.getByText('100%')).toBeInTheDocument()
  })
})
