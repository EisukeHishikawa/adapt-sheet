import { useLayoutEffect, useRef, useState } from 'react'
import { FileText, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { dimensionsFor, useSheetStore } from '@/store/sheetStore'
import { composePreviewDocument, renderTemplate } from '@/lib/template'

// リアルタイムプレビュー（docs/spec.md 2.1「HTMLプレビュー表示エリア」）。
// iframeを使うのは、生成HTML/CSSを親ページのスタイルから隔離して帳票の見た目をそのまま確認するため。
// iframeは常に「用紙の実寸px」で組版し、表示領域に収まるようページ全体をscaleする。枠だけ変えて中身を
// 流し込み直すのではなくページごとズームすることで、用紙サイズ変更や拡大に中身の比率が追従する。
type PreviewPanelProps = {
  expanded: boolean
  onToggleExpand: () => void
}

// 96dpi基準（1inch = 25.4mm = 96px）で用紙の実寸(mm)をCSSピクセルへ換算する。
const PX_PER_MM = 96 / 25.4

// 表示領域に収める倍率（fit）に対する追加のズーム倍率。3倍あれば細部の文字確認には十分と判断した。
const ZOOM_MIN = 1
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

const DEFAULT_DIMENSIONS = dimensionsFor('A4', 'tate')

export function PreviewPanel({ expanded, onToggleExpand }: PreviewPanelProps) {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const cssContent = useSheetStore((state) => state.cssContent)
  const jsonContent = useSheetStore((state) => state.jsonContent)
  const widthMm = useSheetStore((state) => state.widthMm)
  const heightMm = useSheetStore((state) => state.heightMm)

  // JSON入力の編集が（再描画APIを待たずに）プレビューへ即時反映される
  // （docs/spec.md 2.2「リアルタイム双方向プレビュー」）。
  const srcDoc = composePreviewDocument(renderTemplate(htmlContent, jsonContent), cssContent)

  const paperWidthMm = widthMm ?? DEFAULT_DIMENSIONS.widthMm
  const paperHeightMm = heightMm ?? DEFAULT_DIMENSIONS.heightMm
  const pageWidthPx = paperWidthMm * PX_PER_MM
  const pageHeightPx = paperHeightMm * PX_PER_MM

  // 縮小時にズームを1へ戻す（拡大時のズーム状態を持ち越すと、次に開いたとき用紙の一部しか見えず戸惑うため）。
  // useEffect内でのsetStateはreact-hooks/set-state-in-effectが警告する再レンダーの連鎖になるため、
  // Reactが推奨する「レンダー中の調整」パターンを使う。
  const [zoomLevel, setZoomLevel] = useState(1)
  const [prevExpanded, setPrevExpanded] = useState(expanded)
  if (expanded !== prevExpanded) {
    setPrevExpanded(expanded)
    if (!expanded) setZoomLevel(1)
  }

  const containerRef = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const measure = () => {
      setContainer({ width: el.clientWidth, height: el.clientHeight })
    }

    measure()
    // jsdom等ResizeObserver非対応環境では初回measureのみで打ち切る（テストはsrcDocのみ検証）。
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
    // 拡大/縮小で利用可能領域が変わるため測り直す。
  }, [expanded])

  // 未測定（0）の間は0にしておき、レイアウト確定後に正しい倍率へ更新する（初回描画のちらつき防止）。
  const fitScale =
    container.width > 0 && container.height > 0
      ? Math.min(container.width / pageWidthPx, container.height / pageHeightPx)
      : 0
  const scale = fitScale * zoomLevel
  const displayWidth = pageWidthPx * scale
  const displayHeight = pageHeightPx * scale
  const isZoomedBeyondFit = zoomLevel > 1

  const zoomIn = () => setZoomLevel((prev) => Math.min(ZOOM_MAX, Number((prev + ZOOM_STEP).toFixed(2))))
  const zoomOut = () => setZoomLevel((prev) => Math.max(ZOOM_MIN, Number((prev - ZOOM_STEP).toFixed(2))))
  const resetZoom = () => setZoomLevel(1)

  // 真っ白な用紙は「準備中/壊れている」と誤解されやすいため、空のときは用途を示す案内を重ねる。
  const isEmpty = htmlContent.trim() === '' && cssContent.trim() === ''

  return (
    // ズーム操作パネルをスクロールする内側コンテナ（containerRef）の「外」に絶対配置するためのrelative。
    // 内側に置くと、ズームで拡大したページの右下端（スクロールしないと見えない位置）に固定されてしまう。
    <div className="relative flex min-h-[50vh] md:min-h-0 md:flex-1">
      <div
        ref={containerRef}
        // ズーム中に中央寄せのままoverflow-autoにすると、はみ出した領域のうち左・上側へスクロールで
        // 到達できないブラウザ挙動があるため、はみ出す間だけ開始位置（左上）基準の配置へ切り替える。
        className={`flex h-full w-full ${
          isZoomedBeyondFit ? 'items-start justify-start overflow-auto' : 'items-center justify-center overflow-hidden'
        }`}
      >
        {/* ページ枠自体を押下領域にして拡大/縮小をトグルする。ネイティブ<button>だとHTML仕様上
            子に<button>を入れ子にできないため、role="button"のdivにしてキーボード操作を自前で扱う。
            iframeはpointer-events-noneにしてクリックをこのdivへ通す。 */}
        <div
          role="button"
          tabIndex={0}
          aria-label={expanded ? 'プレビューを縮小' : 'プレビューを拡大'}
          onClick={onToggleExpand}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onToggleExpand()
            }
          }}
          // 未測定の間は100%で仮表示する。shrink-0はズーム時のはみ出しをコンテナ側でスクロールさせるため。
          style={{ width: displayWidth || '100%', height: displayHeight || '100%' }}
          className="group relative shrink-0 overflow-hidden rounded-md border border-input bg-white shadow-sm ring-0 transition-all hover:border-ring hover:shadow-md"
        >
          <iframe
            title="プレビュー"
            srcDoc={srcDoc}
            // sandbox未指定のsrcDocは親と同一オリジンで動くため、AI生成HTMLや復元した履歴に
            // <script>が混ざるとsessionStorageのアクセストークンを読み出せてしまう。空指定で
            // 一意オリジン＋スクリプト実行禁止にする（帳票は静的なHTML/CSSのみで成立する。ADR-021）。
            sandbox=""
            tabIndex={-1}
            className="pointer-events-none border-0 bg-white"
            style={{
              width: pageWidthPx,
              height: pageHeightPx,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
          {isEmpty && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/70"
            >
              <FileText className="size-8" strokeWidth={1.5} />
              <span className="text-xs">描画するとここに帳票が表示されます</span>
            </div>
          )}
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md border border-input bg-background/85 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100"
          >
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="absolute bottom-2 right-2 z-10 flex items-center gap-0.5 rounded-md border border-input bg-background/85 p-0.5 text-muted-foreground shadow-sm backdrop-blur-sm">
          <button
            type="button"
            aria-label="ズームアウト"
            disabled={zoomLevel <= ZOOM_MIN}
            onClick={zoomOut}
            className="inline-flex size-7 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <span aria-hidden="true" className="min-w-10 select-none px-1 text-center text-xs tabular-nums">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            type="button"
            aria-label="ズームイン"
            disabled={zoomLevel >= ZOOM_MAX}
            onClick={zoomIn}
            className="inline-flex size-7 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <ZoomIn className="size-3.5" />
          </button>
          {zoomLevel !== 1 && (
            <button
              type="button"
              aria-label="ズームを既定に戻す"
              onClick={resetZoom}
              className="inline-flex size-7 items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
