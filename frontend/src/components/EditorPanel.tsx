import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useSheetStore } from '@/store/sheetStore'

// 右カラムのコード入力エディタ。ステップ16まではHTML/JSON/プロンプトを縦に並べて全て左カラムに
// 置いていたが、レイアウト再設計（ステップ18）で以下のように役割を分割した。
//   - このEditorPanelは右カラム専用とし、HTML入力とJSON入力を「タブ切り替え」で表示する。
//     両方を常時縦積みするより、広い右カラムを1つの入力に使えて編集しやすいため。
//   - サイズ/描画ボタン・PDF・プロンプト・プレビューは左カラム（App.tsx）へ移動した。
// 「HTML入力」「JSON入力」の見出しテキストは画面から非表示にする指示のため、視覚的な<label>は
// 置かず、タブ（HTML/JSON）で内容を示す。アクセシビリティ・テスト用の名前はtextareaの
// aria-labelで従来どおり保持する（SizeControlsと同じ方針）。
// CSS入力エディタは追加しない（ADR-019: CSSはHTML側の<style>に埋め込む前提）。
type EditorTab = 'html' | 'json'

export function EditorPanel() {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const setHtmlContent = useSheetStore((state) => state.setHtmlContent)
  const jsonContent = useSheetStore((state) => state.jsonContent)
  const setJsonContent = useSheetStore((state) => state.setJsonContent)

  // どちらのタブを表示中か。既定はHTML（帳票の骨組みが主入力のため）。
  // タブ切り替えで非表示側のtextareaはアンマウントされるが、入力値はZustandストアが
  // 保持しているため、タブを戻せば内容はそのまま復元される（ローカルstateを持たない設計）。
  const [activeTab, setActiveTab] = useState<EditorTab>('html')

  return (
    <div className="flex h-full w-1/2 flex-col gap-2 p-4">
      {/* HTML/JSONのタブ。role=tab/aria-selectedでアクセシビリティとテスト（getByRole('tab')）に対応する。 */}
      <div role="tablist" aria-label="入力形式" className="flex gap-1 border-b border-input">
        {(['html', 'json'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            // 選択中タブは下線（border-b-2）と濃い文字色で示す。-mb-pxでtablistの下罫線に重ねる。
            className={cn(
              '-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === tab
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {activeTab === 'html' ? (
        <textarea
          id="html-editor"
          aria-label="HTML入力"
          className="w-full flex-1 resize-none rounded-md border border-input bg-background p-2 font-mono text-sm"
          value={htmlContent}
          onChange={(event) => setHtmlContent(event.target.value)}
        />
      ) : (
        // ステップ16: 業務データJSON入力。JSON構文チェックはフロントで重複実装せず、
        // バックエンドの既存の400 VALIDATION_ERROR（docs/spec.md 4章）に委ねる。
        <textarea
          id="json-editor"
          aria-label="JSON入力"
          className="w-full flex-1 resize-none rounded-md border border-input bg-background p-2 font-mono text-sm"
          value={jsonContent}
          onChange={(event) => setJsonContent(event.target.value)}
        />
      )}
    </div>
  )
}
