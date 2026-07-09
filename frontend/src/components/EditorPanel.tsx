import { Button } from '@/components/ui/button'
import { PdfDropzone } from '@/components/PdfDropzone'
import { SizeControls } from '@/components/SizeControls'
import { useSheetStore } from '@/store/sheetStore'

// 左カラムの入力エディタ。ステップ4は「超最小」実装のためHTML入力のtextarea一つのみだったが、
// ステップ16でJSON入力・プロンプト入力を追加し、docs/spec.md 2.1「3大入力エディタ」を実装した。
// CSS入力エディタは追加しない：CSSは常にHTML側の<style>に埋め込まれる前提であり
// （ユーザー入力・Docling変換結果のいずれでも同様であることを実装調査で確認済み）、独立した
// 入力欄・APIフィールドを持つ意味がないと判断してADR-019として記録した。
// 入力値をローカルstateに持たず、直接Zustandストアを更新することで
// 右カラム（PreviewPanel）とのリアルタイム連動をストア経由の一方向データフローで実現する。
// ステップ5で「描画」ボタンを追加し、押下時にfetchRender（バックエンドの/api/render）を呼び出す。
export function EditorPanel() {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const setHtmlContent = useSheetStore((state) => state.setHtmlContent)
  const jsonContent = useSheetStore((state) => state.jsonContent)
  const setJsonContent = useSheetStore((state) => state.setJsonContent)
  const promptContent = useSheetStore((state) => state.promptContent)
  const setPromptContent = useSheetStore((state) => state.setPromptContent)
  const isLoading = useSheetStore((state) => state.isLoading)
  const fetchRender = useSheetStore((state) => state.fetchRender)

  return (
    <div className="flex h-full w-1/2 flex-col gap-2 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <label htmlFor="html-editor" className="text-sm font-medium">
          HTML入力
        </label>
        <Button onClick={() => fetchRender()} disabled={isLoading}>
          {isLoading ? '描画中...' : '描画'}
        </Button>
      </div>
      {/* ステップ8: 定型サイズ自動入力・手動サイズ指定（docs/spec.md 2.1/2.2）。 */}
      <SizeControls />
      {/* ステップ7: 既存PDFをベースにしたい場合のアップロード導線（docs/spec.md 2.1）。 */}
      <PdfDropzone />
      <textarea
        id="html-editor"
        aria-label="HTML入力"
        className="min-h-48 w-full flex-1 resize-none rounded-md border border-input bg-background p-2 font-mono text-sm"
        value={htmlContent}
        onChange={(event) => setHtmlContent(event.target.value)}
      />
      {/* ステップ16: 業務データJSON入力。バリデーション（JSON構文チェック）はフロントで
          重複実装せず、バックエンドの既存の400 VALIDATION_ERROR（docs/spec.md 4章）に委ねる。 */}
      <label htmlFor="json-editor" className="text-sm font-medium">
        JSON入力
      </label>
      <textarea
        id="json-editor"
        aria-label="JSON入力"
        className="h-32 w-full resize-none rounded-md border border-input bg-background p-2 font-mono text-sm"
        value={jsonContent}
        onChange={(event) => setJsonContent(event.target.value)}
      />
      {/* ステップ16: 生成方針の自然言語指示。レスポンスに対応するフィールドが無いため、
          描画後もユーザーが入力した文言をそのまま保持する（sheetStore.fetchRender参照）。 */}
      <label htmlFor="prompt-editor" className="text-sm font-medium">
        プロンプト入力
      </label>
      <textarea
        id="prompt-editor"
        aria-label="プロンプト入力"
        className="h-24 w-full resize-none rounded-md border border-input bg-background p-2 text-sm"
        value={promptContent}
        onChange={(event) => setPromptContent(event.target.value)}
      />
      {/* ステップ8: エラー/成功の表示はMessageToast（App直下）へ集約したため、
          ここでのインライン表示は撤去した。role="alert"が二重にならないようにする狙いもある。 */}
    </div>
  )
}
