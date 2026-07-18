import { useEffect, useState } from 'react'
import { Loader2, Moon, Sparkles, Sun } from 'lucide-react'
import { EditorPanel } from '@/components/EditorPanel'
import { EngineSelect } from '@/components/EngineSelect'
import { PreviewPanel } from '@/components/PreviewPanel'
import { PromptInput } from '@/components/PromptInput'
import { PdfDropzone } from '@/components/PdfDropzone'
import { SizeControls } from '@/components/SizeControls'
import { HistorySlider } from '@/components/HistorySlider'
import { MessageToast } from '@/components/MessageToast'
import { Button } from '@/components/ui/button'
import { useSheetStore } from '@/store/sheetStore'
import { useTheme } from '@/lib/useTheme'

// 2カラム構成。左：サイズ操作・描画ボタン・PDF・プロンプト・プレビュー / 右：HTML/JSONのコード入力。
// 各パネルはpropsで繋がず、それぞれがZustandストア（sheetStore）を参照して連動する。
function App() {
  // 拡大表示中は左カラム上部（操作系・プロンプト）を隠し、プレビューだけを左カラムいっぱいに広げる。
  // 状態はここで一元管理し、PreviewPanelはトグルの発火のみ担う。
  const [previewExpanded, setPreviewExpanded] = useState(false)

  return (
    // md未満（モバイル）はh-screen固定を外してページ全体を縦スクロールさせ、2カラムを縦積みにする。
    // md以上は1画面完結（h-screen＋各パネル内スクロール）を維持する。
    <main className="flex min-h-screen w-full flex-col bg-background text-foreground md:h-screen md:w-screen">
      <AppHeader />

      <div className="flex flex-col gap-4 md:min-h-0 md:flex-1 md:flex-row md:gap-0">
        <div className="flex w-full flex-col gap-3 p-4 md:h-full md:w-1/2 md:border-r md:border-input">
          {/* 条件付きレンダリングで隠すとRenderingProgressごとアンマウントされ、拡大・縮小のたびに
              経過秒数が0へ戻ってしまう。display:contents（子要素は親のflexレイアウトへ直接参加する）で
              マウントを保ったまま見た目だけ隠す。 */}
          <div className={previewExpanded ? 'hidden' : 'contents'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SizeControls />
              <div className="flex flex-wrap items-center gap-2">
                <EngineSelect />
                <RenderButton />
              </div>
            </div>
            <PdfDropzone />
            <PromptInput />
          </div>
          <PreviewPanel expanded={previewExpanded} onToggleExpand={() => setPreviewExpanded((prev) => !prev)} />
        </div>

        <EditorPanel />
      </div>

      <div className="border-t border-input px-4">
        <HistorySlider />
      </div>
      <MessageToast />
    </main>
  )
}

function AppHeader() {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-input px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <BrandMark className="size-7 shrink-0" />
        <div className="flex flex-col leading-none">
          <h1 className="text-sm font-semibold tracking-tight">AdaptSheet AI</h1>
          <p className="mt-0.5 hidden text-[11px] text-muted-foreground sm:block">帳票作成AI支援プラットフォーム</p>
        </div>
      </div>
      <ThemeToggle />
    </header>
  )
}

// favicon.svgと同じモチーフをインラインSVGで再現し、画面内でもタブアイコンと同じ識別性を持たせる。
// currentColorではなくグラデーション固定色にして、ライト/ダークどちらの背景でもブランド色を保つ。
function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="brandMark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill="url(#brandMark)" />
      <path d="M9 8a2 2 0 0 1 2-2h6.6L23 11.4V24a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2z" fill="#ffffff" />
      <path d="M17.6 6 23 11.4h-3.8a1.6 1.6 0 0 1-1.6-1.6z" fill="#C7D2FE" />
      <rect x="11.6" y="14.4" width="8.8" height="1.7" rx="0.85" fill="#A5B4FC" />
      <rect x="11.6" y="17.9" width="8.8" height="1.7" rx="0.85" fill="#A5B4FC" />
      <rect x="11.6" y="21.4" width="5.2" height="1.7" rx="0.85" fill="#A5B4FC" />
      <path d="M22.8 18.6c.78 2.34 1.06 2.62 3.4 3.4-2.34.78-2.62 1.06-3.4 3.4-.78-2.34-1.06-2.62-3.4-3.4 2.34-.78 2.62-1.06 3.4-3.4Z" fill="#FBBF24" />
    </svg>
  )
}

// アクセシブルネームは現在の状態ではなく「行き先」を伝える文言にする。
function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}

// isLoading/fetchRenderの購読をこの小さなコンポーネントに閉じ込め、描画状態の変化で
// Appのレイアウト全体が再レンダリングされないようにする。
function RenderButton() {
  const isLoading = useSheetStore((state) => state.isLoading)
  const fetchRender = useSheetStore((state) => state.fetchRender)
  return (
    <Button onClick={() => fetchRender()} disabled={isLoading}>
      {isLoading ? (
        <RenderingProgress />
      ) : (
        <>
          <Sparkles />
          描画
        </>
      )}
    </Button>
  )
}

// PDFアップロード時のDocling解析は十数秒かかることがあり、進捗が見えないと「固まっている」と
// 誤解されるため経過秒数を出す（ADR-015）。isLoadingの間だけマウントされる設計により、
// 秒数のリセットをuseEffect内のsetStateで行う必要がない（アンマウントで自然に0へ戻る）。
function RenderingProgress() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const intervalId = setInterval(() => setSeconds((prev) => prev + 1), 1000)
    return () => clearInterval(intervalId)
  }, [])
  return (
    <>
      <Loader2 className="animate-spin" />
      {`描画中...(${seconds}秒)`}
    </>
  )
}

export default App
