import { useState } from 'react'
import { CodeEditor } from '@/components/CodeEditor'
import { cn } from '@/lib/utils'
import { useSheetStore } from '@/store/sheetStore'

// 右カラムのコード入力。HTML・CSS・JSONを縦に並べず「タブ切り替え」にすることで、広い右カラムを
// 1つの入力に使えて編集しやすくする。CSSはプレビュー合成時（composePreviewDocument）にHTML末尾の
// <style>へ結合されるため、HTML本文の<style>とは別に独立したタブとして持つ。
// 見出しは画面に出さないため、名前はtextareaのaria-labelで保持する（SizeControlsと同じ方針）。
type EditorTab = 'html' | 'css' | 'json'

export function EditorPanel() {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const setHtmlContent = useSheetStore((state) => state.setHtmlContent)
  const cssContent = useSheetStore((state) => state.cssContent)
  const setCssContent = useSheetStore((state) => state.setCssContent)
  const jsonContent = useSheetStore((state) => state.jsonContent)
  const setJsonContent = useSheetStore((state) => state.setJsonContent)

  // 非表示側のtextareaはアンマウントされるが、入力値はストアが保持しているためタブを戻せば復元される。
  const [activeTab, setActiveTab] = useState<EditorTab>('html')

  return (
    // md未満（左カラムの下に縦積みされる）ではmin-h-[60vh]で自身の高さを確保する。祖先に固定高さが
    // 無いためh-fullでは潰れてしまう。md以上は右カラム固定幅＋h-full。
    <div className="flex min-h-[60vh] w-full flex-col gap-2 p-4 md:h-full md:min-h-0 md:w-1/2">
      <div role="tablist" aria-label="入力形式" className="flex gap-1 border-b border-input">
        {(['html', 'css', 'json'] as const).map((tab) => (
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

      {activeTab === 'html' && (
        <CodeEditor
          id="html-editor"
          ariaLabel="HTML入力"
          language="html"
          value={htmlContent}
          onChange={setHtmlContent}
        />
      )}
      {activeTab === 'css' && (
        <CodeEditor id="css-editor" ariaLabel="CSS入力" language="css" value={cssContent} onChange={setCssContent} />
      )}
      {activeTab === 'json' && (
        // JSON構文チェックはフロントで重複実装せず、バックエンドの400 VALIDATION_ERRORに委ねる。
        <CodeEditor
          id="json-editor"
          ariaLabel="JSON入力"
          language="json"
          value={jsonContent}
          onChange={setJsonContent}
        />
      )}
    </div>
  )
}
