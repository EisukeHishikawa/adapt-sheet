import { useState } from 'react'
import { EditorPanel } from '@/components/EditorPanel'
import { PreviewPanel } from '@/components/PreviewPanel'
import { PromptInput } from '@/components/PromptInput'
import { PdfDropzone } from '@/components/PdfDropzone'
import { SizeControls } from '@/components/SizeControls'
import { HistorySlider } from '@/components/HistorySlider'
import { MessageToast } from '@/components/MessageToast'
import { Button } from '@/components/ui/button'
import { useSheetStore } from '@/store/sheetStore'

// ステップ18: レイアウト再設計。従来の「左：入力 / 右：プレビュー」から次の2カラム構成へ変更した。
//   左カラム: [サイズ操作 + 描画ボタン] / [PDFドロップ] / [プロンプト] / [プレビュー]
//   右カラム: [HTML/JSONタブ切り替えのコード入力]
// プレビューは左カラム下部に置き、押下で左カラム全体へ拡大表示する（previewExpanded）。
// 各パネルはpropsで直接繋がず、それぞれ内部でZustandストア（sheetStore）を参照して連動する。
function App() {
  // プレビュー拡大表示の状態。拡大中は左カラム上部（操作系・プロンプト）を隠し、プレビューだけを
  // 左カラムいっぱいに広げる。状態はここで一元管理し、PreviewPanelはトグルの発火のみ担う。
  const [previewExpanded, setPreviewExpanded] = useState(false)

  return (
    // ステップ20: レスポンシブ対応。md未満（モバイル）ではh-screen固定を外してページ全体を
    // 縦スクロールさせ、2カラムを縦積みに変える。md以上（デスクトップ）は既存のh-screen＋
    // 内部スクロールの1画面完結レイアウトを維持する（TypeScriptロジックは変更しない）。
    <main className="flex min-h-screen w-full flex-col bg-background text-foreground md:h-screen md:w-screen">
      {/* サイト名。ブラウザタブ（index.htmlのtitle）と揃えて画面上にも常時表示する。 */}
      <header className="border-b border-input px-4 py-2">
        <h1 className="text-sm font-semibold">AdaptSheet AI</h1>
      </header>

      {/* 2カラムの主要領域。モバイルは縦積み（flex-col）、md以上は横並び（flex-row）＋
          flex-1で縦方向の残り高さを占有し、はみ出しは各パネル内で処理する。 */}
      <div className="flex flex-col gap-4 md:min-h-0 md:flex-1 md:flex-row md:gap-0">
        {/* 左カラム: 操作系 + プロンプト + プレビュー。拡大時は上部要素を隠してプレビューを最大化する。 */}
        <div className="flex w-full flex-col gap-2 p-4 md:h-full md:w-1/2">
          {!previewExpanded && (
            <>
              {/* 上段: サイズ操作を左、描画ボタンを右端に寄せる（justify-between）。狭幅では折り返す。 */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SizeControls />
                <RenderButton />
              </div>
              {/* ステップ7: 既存PDFをベースにしたい場合のアップロード導線（docs/spec.md 2.1）。 */}
              <PdfDropzone />
              {/* ステップ16: 生成方針の自然言語指示（プレースホルダ表示）。 */}
              <PromptInput />
            </>
          )}
          <PreviewPanel expanded={previewExpanded} onToggleExpand={() => setPreviewExpanded((prev) => !prev)} />
        </div>

        {/* 右カラム: HTML/JSONタブのコード入力。 */}
        <EditorPanel />
      </div>

      {/* ステップ8: 描画履歴スライダ（docs/spec.md 2.2）。画面下部に横並びで固定表示する。 */}
      <div className="border-t border-input px-4">
        <HistorySlider />
      </div>
      {/* ステップ8: エラー/成功メッセージのトースト（docs/spec.md 2.2）。position:fixedで最前面に出す。 */}
      <MessageToast />
    </main>
  )
}

// 描画ボタン。isLoading/fetchRenderの購読をこの小さなコンポーネントに閉じ込め、
// Appのレイアウトが描画状態の変化で再レンダリングされないようにする。
function RenderButton() {
  const isLoading = useSheetStore((state) => state.isLoading)
  const fetchRender = useSheetStore((state) => state.fetchRender)
  return (
    <Button onClick={() => fetchRender()} disabled={isLoading}>
      {isLoading ? '描画中...' : '描画'}
    </Button>
  )
}

export default App
