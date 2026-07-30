import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { CodeEditor } from './CodeEditor'

// 見出しは非表示のため、aria-labelでの参照・行番号表示・入力連動・シンタックスハイライト・
// コピーボタンという「モダンなコードエディタらしさ」の中核を固定する。
// Tabキー挿入・実クリップボード書き込みはjsdomの制約で不安定なため単体テストでは扱わない。
describe('CodeEditor（コードエディタ風入力UI）', () => {
  // onChangeで親stateが更新される最小のラッパ。行番号・ハイライトは値に追従するため、
  // 制御コンポーネントとして実際に値を反映させて検証する。
  function Harness() {
    const [value, setValue] = useState('a\nb\nc')
    return <CodeEditor ariaLabel="HTML入力" language="html" value={value} onChange={setValue} />
  }

  it('行数ぶんの行番号が表示される', () => {
    render(<CodeEditor ariaLabel="HTML入力" language="html" value={'x\ny'} onChange={() => {}} />)

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('空文字でも1行目の行番号を表示する', () => {
    render(<CodeEditor ariaLabel="HTML入力" language="html" value="" onChange={() => {}} />)

    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('入力するとonChangeが呼ばれ、行番号が行数に追従する', () => {
    render(<Harness />)

    const editor = screen.getByRole('textbox', { name: 'HTML入力' })
    fireEvent.change(editor, { target: { value: 'one\ntwo\nthree\nfour' } })

    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('HTMLがprismのトークン（.token）として色分けされる', () => {
    const { container } = render(
      <CodeEditor ariaLabel="HTML入力" language="html" value="<h1>タイトル</h1>" onChange={() => {}} />,
    )

    // prismがタグ等を<span class="token ...">へトークン化していることを確認する。
    expect(container.querySelector('.token')).not.toBeNull()
  })

  it('CSSがprismのトークン（.token）として色分けされる', () => {
    const { container } = render(
      <CodeEditor ariaLabel="CSS入力" language="css" value="body { color: red; }" onChange={() => {}} />,
    )

    expect(container.querySelector('.token')).not.toBeNull()
  })

  it('コピーボタンが表示される', () => {
    render(<CodeEditor ariaLabel="JSON入力" language="json" value='{"a":1}' onChange={() => {}} />)

    expect(screen.getByRole('button', { name: 'コピー' })).toBeInTheDocument()
  })

  it('readOnly時は入力欄がreadOnlyになり、変更してもonChangeが呼ばれない', () => {
    const handleChange = vi.fn()
    render(
      <CodeEditor ariaLabel="HTML入力" language="html" value="<p>a</p>" onChange={handleChange} readOnly />,
    )

    const editor = screen.getByRole('textbox', { name: 'HTML入力' })
    expect(editor).toHaveAttribute('readonly')

    fireEvent.change(editor, { target: { value: '<p>changed</p>' } })
    expect(handleChange).not.toHaveBeenCalled()
  })
})
