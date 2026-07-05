// Vitest + React Testing Library環境が正しく動作することを確認するための
// サンプルコンポーネント（DEVELOPMENT.md ステップ3の「テスト確認」用）。
type GreetingProps = {
  name: string
}

export function Greeting({ name }: GreetingProps) {
  return <p>Hello, {name}!</p>
}
