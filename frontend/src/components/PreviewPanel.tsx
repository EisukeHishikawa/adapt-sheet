import { useSheetStore } from '@/store/sheetStore'

// 右カラムのリアルタイムプレビュー。iframeを使うのは、生成されたHTML/CSSを
// 親ページのスタイルから隔離した状態で描画し、帳票の見た目をそのまま確認できるようにするため
// （docs/spec.md 2.1「HTMLプレビュー表示エリア」）。
// srcDocにストアの値をそのまま渡すことで、ストア更新のたびに自動で再描画される。
export function PreviewPanel() {
  const htmlContent = useSheetStore((state) => state.htmlContent)

  return (
    <div className="h-full w-1/2 p-4">
      <iframe title="プレビュー" srcDoc={htmlContent} className="h-full w-full rounded-md border border-input bg-white" />
    </div>
  )
}
