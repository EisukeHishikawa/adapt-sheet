import { useEffect, useState } from 'react'
import { Loader2, Moon, Sparkles, Sun } from 'lucide-react'
import { EditorPanel } from '@/components/EditorPanel'
import { PreviewPanel } from '@/components/PreviewPanel'
import { PromptInput } from '@/components/PromptInput'
import { PdfDropzone } from '@/components/PdfDropzone'
import { SizeControls } from '@/components/SizeControls'
import { HistorySlider } from '@/components/HistorySlider'
import { MessageToast } from '@/components/MessageToast'
import { Button } from '@/components/ui/button'
import { useSheetStore } from '@/store/sheetStore'
import { useTheme } from '@/lib/useTheme'

// ステップ18: レイアウト再設計。従来の「左：入力 / 右：プレビュー」から次の2カラム構成へ変更した。
//   左カラム: [サイズ操作 + 描画ボタン] / [PDFドロップ] / [プロンプト] / [プレビュー]
//   右カラム: [HTML/JSONタブ切り替えのコード入力]
// プレビューは左カラム下部に置き、押下で左カラム全体へ拡大表示する（previewExpanded）。
// 各パネルはpropsで直接繋がず、それぞれ内部でZustandストア（sheetStore）を参照して連動する。
// ステップ21: ヘッダーにブランドマーク・キャッチ・テーマ切替を追加し、区画の余白/境界の質感を整えた。
function App() {
  // プレビュー拡大表示の状態。拡大中は左カラム上部（操作系・プロンプト）を隠し、プレビューだけを
  // 左カラムいっぱいに広げる。状態はここで一元管理し、PreviewPanelはトグルの発火のみ担う。
  const [previewExpanded, setPreviewExpanded] = useState(false)

  return (
    // ステップ20: レスポンシブ対応。md未満（モバイル）ではh-screen固定を外してページ全体を
    // 縦スクロールさせ、2カラムを縦積みに変える。md以上（デスクトップ）は既存のh-screen＋
    // 内部スクロールの1画面完結レイアウトを維持する（TypeScriptロジックは変更しない）。
    <main className="flex min-h-screen w-full flex-col bg-background text-foreground md:h-screen md:w-screen">
      <AppHeader />

      {/* 2カラムの主要領域。モバイルは縦積み（flex-col）、md以上は横並び（flex-row）＋
          flex-1で縦方向の残り高さを占有し、はみ出しは各パネル内で処理する。 */}
      <div className="flex flex-col gap-4 md:min-h-0 md:flex-1 md:flex-row md:gap-0">
        {/* 左カラム: 操作系 + プロンプト + プレビュー。拡大時は上部要素を隠してプレビューを最大化する。
            md以上では右カラムとの境界に縦罫線（border-r）を引き、2区画を明確に分ける。 */}
        <div className="flex w-full flex-col gap-3 p-4 md:h-full md:w-1/2 md:border-r md:border-input">
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

// ヘッダー。ブランドマーク＋サイト名＋キャッチと、右端にテーマ切替を置く。
// サイト名はブラウザタブ（index.htmlのtitle）と揃える。
function AppHeader() {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-input px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <BrandMark className="size-7 shrink-0" />
        <div className="flex flex-col leading-none">
          <h1 className="text-sm font-semibold tracking-tight">AdaptSheet AI</h1>
          {/* 補足キャッチ。狭幅では畳んで（hidden）ロゴ＋名称のみにする。 */}
          <p className="mt-0.5 hidden text-[11px] text-muted-foreground sm:block">帳票作成AI支援プラットフォーム</p>
        </div>
      </div>
      <ThemeToggle />
    </header>
  )
}

// ヘッダー用のブランドマーク。favicon.svgと同じ「帳票×AIきらめき」のモチーフをインラインSVGで
// 簡略再現する（画面内でもタブアイコンと同一の識別性を持たせるため）。currentColorではなく
// グラデーション固定色にして、ライト/ダークどちらの背景でもブランド色が保たれるようにする。
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

// テーマ切替ボタン。現在がダークなら太陽（ライトへ）、ライトなら月（ダークへ）を出す。
// アクセシブルネームは行き先が伝わる文言にして、状態変化をスクリーンリーダーにも示す。
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

// 描画ボタン。isLoading/fetchRenderの購読をこの小さなコンポーネントに閉じ込め、
// Appのレイアウトが描画状態の変化で再レンダリングされないようにする。
// ステップ21: 主要アクションであることが伝わるよう、アイコン（生成中はスピナー）を添える。
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

// ステップ22: Docling解析（PDFアップロード時）は数秒〜十数秒かかることがあり、
// 「操作が固まっている」と誤解されやすいため、経過秒数を1秒ごとに表示する（ユーザー要望）。
// RenderButtonはisLoading=trueの間だけ本コンポーネントをマウントする。マウントのたびに
// useStateの初期値(0)から数え直されるため、「isLoadingがfalseに戻ったら0にリセットする」処理を
// 別途持つ必要がない（アンマウント→次回マウントで自然に0から始まる）。
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
