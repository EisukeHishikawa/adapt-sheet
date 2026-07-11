import { useSheetStore } from '@/store/sheetStore'

// promptはそのままGeminiへの動的プロンプトに埋め込まれるため、プロンプトインジェクション・
// トークン濫用への対策としてバックエンド（app/main.pyのForm(max_length=100)）と同じ上限を設け、
// 二重に制限する。
const MAX_PROMPT_LENGTH = 100

// 生成方針の自然言語指示。見出しは画面に出さずプレースホルダで用途を示すため、名前はaria-labelで保持する。
export function PromptInput() {
  const promptContent = useSheetStore((state) => state.promptContent)
  const setPromptContent = useSheetStore((state) => state.setPromptContent)

  return (
    <textarea
      id="prompt-editor"
      aria-label="プロンプト入力"
      placeholder="プロンプトを入力してください。"
      maxLength={MAX_PROMPT_LENGTH}
      className="h-20 w-full resize-none rounded-md border border-input bg-background p-2.5 text-sm placeholder:text-muted-foreground/70 transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      value={promptContent}
      onChange={(event) => setPromptContent(event.target.value)}
    />
  )
}
