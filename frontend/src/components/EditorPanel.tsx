import { Button } from '@/components/ui/button'
import { useSheetStore } from '@/store/sheetStore'

// 左カラムの入力エディタ。ステップ4は「超最小」実装のためHTML入力のtextarea一つのみとし、
// CSS/JSON/プロンプト等の追加エディタはフェーズ2以降のステップで拡張する。
// 入力値をローカルstateに持たず、直接Zustandストアを更新することで
// 右カラム（PreviewPanel）とのリアルタイム連動をストア経由の一方向データフローで実現する。
// ステップ5で「描画」ボタンを追加し、押下時にfetchRender（バックエンドの/api/render）を呼び出す。
export function EditorPanel() {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const setHtmlContent = useSheetStore((state) => state.setHtmlContent)
  const isLoading = useSheetStore((state) => state.isLoading)
  const error = useSheetStore((state) => state.error)
  const fetchRender = useSheetStore((state) => state.fetchRender)

  return (
    <div className="flex h-full w-1/2 flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <label htmlFor="html-editor" className="text-sm font-medium">
          HTML入力
        </label>
        <Button onClick={() => fetchRender()} disabled={isLoading}>
          {isLoading ? '描画中...' : '描画'}
        </Button>
      </div>
      <textarea
        id="html-editor"
        aria-label="HTML入力"
        className="h-full w-full flex-1 resize-none rounded-md border border-input bg-background p-2 font-mono text-sm"
        value={htmlContent}
        onChange={(event) => setHtmlContent(event.target.value)}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
