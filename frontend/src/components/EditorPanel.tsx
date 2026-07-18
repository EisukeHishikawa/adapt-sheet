import { useState } from 'react'
import { cn } from '@/lib/utils'
import { CodeEditor } from '@/components/CodeEditor'
import { useSheetStore } from '@/store/sheetStore'

// 右カラムのコード入力。HTMLとJSONを縦に並べず「タブ切り替え」にすることで、広い右カラムを
// 1つの入力に使えて編集しやすくする。CSS入力は持たない（ADR-015）。
// 見出しは画面に出さないため、名前はtextareaのaria-labelで保持する（SizeControlsと同じ方針）。
type EditorTab = 'html' | 'json'

export function EditorPanel() {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const setHtmlContent = useSheetStore((state) => state.setHtmlContent)
  const jsonContent = useSheetStore((state) => state.jsonContent)
  const setJsonContent = useSheetStore((state) => state.setJsonContent)

  // 非表示側のtextareaはアンマウントされるが、入力値はストアが保持しているためタブを戻せば復元される。
  const [activeTab, setActiveTab] = useState<EditorTab>('html')

  return (
    // md未満（左カラムの下に縦積みされる）ではmin-h-[60vh]で自身の高さを確保する。祖先に固定高さが
    // 無いためh-fullでは潰れてしまう。md以上は右カラム固定幅＋h-full。
    <div className="flex min-h-[60vh] w-full flex-col gap-2 p-4 md:h-full md:min-h-0 md:w-1/2">
      <div role="tablist" aria-label="入力形式" className="flex gap-1 border-b border-input">
        {(['html', 'json'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              // -mb-pxで選択中タブの下線をtablistの罫線に重ねる。
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
        <CodeEditor id="html-editor" ariaLabel="HTML入力" language="html" value={htmlContent} onChange={setHtmlContent} />
      ) : (
        // JSON構文チェックはフロントで重複実装せず、バックエンドの400 VALIDATION_ERRORに委ねる。
        <CodeEditor id="json-editor" ariaLabel="JSON入力" language="json" value={jsonContent} onChange={setJsonContent} />
      )}
    </div>
  )
}
