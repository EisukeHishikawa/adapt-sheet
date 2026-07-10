import { useSheetStore } from '@/store/sheetStore'

// 左カラムのプロンプト入力欄。ステップ18のレイアウト再設計でEditorPanel（右カラム）から
// 独立させ、サイズ操作・PDF・プレビューと同じ左カラムに配置する。
// 「プロンプト入力」という見出しテキストは非表示にする指示のため、視覚的な<label>は置かず、
// プレースホルダ「プロンプトを入力してください。」で用途を示す。名前（アクセシビリティ・テスト用）は
// aria-labelで保持する。レスポンスに対応するフィールドが無いため、描画後も入力値は保持される
// （sheetStore.fetchRender参照）。
export function PromptInput() {
  const promptContent = useSheetStore((state) => state.promptContent)
  const setPromptContent = useSheetStore((state) => state.setPromptContent)

  return (
    <textarea
      id="prompt-editor"
      aria-label="プロンプト入力"
      placeholder="プロンプトを入力してください。"
      className="h-20 w-full resize-none rounded-md border border-input bg-background p-2 text-sm"
      value={promptContent}
      onChange={(event) => setPromptContent(event.target.value)}
    />
  )
}
