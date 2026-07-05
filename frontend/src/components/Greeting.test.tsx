import { render, screen } from '@testing-library/react'
import { Greeting } from './Greeting'

// TDD（Red→Green）でVitest+RTLの疎通を確認するための最小テスト。
// 実装前に本テストを書き、Greetingコンポーネント未実装によるRed状態を確認済み。
describe('Greeting', () => {
  it('nameプロップを含んだ挨拶文を表示する', () => {
    render(<Greeting name="adapt-sheet" />)

    expect(screen.getByText('Hello, adapt-sheet!')).toBeInTheDocument()
  })
})
