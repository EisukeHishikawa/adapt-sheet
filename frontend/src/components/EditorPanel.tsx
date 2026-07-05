import { useSheetStore } from '@/store/sheetStore'

// 左カラムの入力エディタ。ステップ4は「超最小」実装のためHTML入力のtextarea一つのみとし、
// CSS/JSON/プロンプト等の追加エディタはフェーズ2以降のステップで拡張する。
// 入力値をローカルstateに持たず、直接Zustandストアを更新することで
// 右カラム（PreviewPanel）とのリアルタイム連動をストア経由の一方向データフローで実現する。
export function EditorPanel() {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const setHtmlContent = useSheetStore((state) => state.setHtmlContent)

  return (
    <div className="flex h-full w-1/2 flex-col gap-2 p-4">
      <label htmlFor="html-editor" className="text-sm font-medium">
        HTML入力
      </label>
      <textarea
        id="html-editor"
        aria-label="HTML入力"
        className="h-full w-full flex-1 resize-none rounded-md border border-input bg-background p-2 font-mono text-sm"
        value={htmlContent}
        onChange={(event) => setHtmlContent(event.target.value)}
      />
    </div>
  )
}
