import { Button } from '@/components/ui/button'

// ステップ3時点では画面設計が未着手のため、Tailwind/shadcn-uiの導入確認用に
// 最小構成（見出し + shadcnのButton）のみを描画する仮のルートコンポーネント。
// ステップ4で2カラムレイアウトへ置き換える。
function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-3xl font-bold">adapt-sheet</h1>
      <Button>Get Started</Button>
    </main>
  )
}

export default App
