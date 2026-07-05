import { EditorPanel } from '@/components/EditorPanel'
import { PreviewPanel } from '@/components/PreviewPanel'

// ステップ4：「左：入力、右：リアルタイムプレビュー」の2カラム最小画面のルートコンポーネント。
// 両パネルはpropsで直接繋がず、それぞれ内部でZustandストア（sheetStore）を参照することで、
// 将来コントロール類（描画ボタン等、ステップ5以降）を挟んでも配線を変えずに済むようにする。
function App() {
  return (
    <main className="flex h-screen w-screen bg-background text-foreground">
      <EditorPanel />
      <PreviewPanel />
    </main>
  )
}

export default App
