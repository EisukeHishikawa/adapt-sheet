// Vitest + React Testing Library環境が正しく動作することを確認するためのサンプルコンポーネント。
type GreetingProps = {
  name: string
}

export function Greeting({ name }: GreetingProps) {
  return <p>Hello, {name}!</p>
}
