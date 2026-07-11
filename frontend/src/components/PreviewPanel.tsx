import { useLayoutEffect, useRef, useState } from 'react'
import { FileText, Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { SIZE_PRESETS, useSheetStore } from '@/store/sheetStore'
import { renderTemplate } from '@/lib/template'

// 左カラム下部のリアルタイムプレビュー。iframeを使うのは、生成されたHTML/CSSを
// 親ページのスタイルから隔離した状態で描画し、帳票の見た目をそのまま確認できるようにするため
// （docs/spec.md 2.1「HTMLプレビュー表示エリア」）。
// ステップ18で以下を実現している：
//   - サイズ（widthMm/heightMm）に合わせてプレビューの縦横比を変える（用紙の向きが一目でわかる）。
//   - プレビューを押下すると左カラム全体へ拡大表示する（expanded、App側で他要素を隠して実現）。
//   - iframeを「用紙の実寸(px)」で組版し、表示領域に収まるよう全体をscaleで拡大縮小する。
//     こうすると用紙サイズの変更やプレビュー拡大に伴って中身(HTML)の比率もそのまま追従する
//     （枠だけ変えて中身を流し込み直すのではなく、ページをズームする挙動）。
// ステップ22b: 拡大表示（expanded）中でも用紙全体を収める「contain」スケールのままだと、
// 文字が小さく読み取りづらいというユーザー要望を受け、拡大表示中のみズームイン/アウト操作を追加した。
// ズーム後は用紙が表示領域からはみ出しうるため、コンテナをスクロール可能にする。
type PreviewPanelProps = {
  // 拡大表示中かどうか。表示自体はApp側のレイアウトで制御し、ここでは押下時のラベル切り替えに使う。
  expanded: boolean
  // プレビュー押下で拡大/縮小をトグルするハンドラ（状態はApp側が保持）。
  onToggleExpand: () => void
}

// 用紙の実寸(mm)をCSSピクセルへ換算する係数（96dpi基準: 1inch=25.4mm=96px）。
// これでiframeを「A4なら約794×1123px」といった実寸ページとして組版し、後段でscaleして収める。
const PX_PER_MM = 96 / 25.4

// ズーム倍率（表示領域に収める「contain」スケールに対する追加倍率）の範囲・刻み。
// 1が「収める」既定値、最大3倍まで拡大できれば細部の文字確認には十分と判断した。
const ZOOM_MIN = 1
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

export function PreviewPanel({ expanded, onToggleExpand }: PreviewPanelProps) {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const cssContent = useSheetStore((state) => state.cssContent)
  const jsonContent = useSheetStore((state) => state.jsonContent)
  const widthMm = useSheetStore((state) => state.widthMm)
  const heightMm = useSheetStore((state) => state.heightMm)

  // CLAUDE.md「固定情報と業務データの分離」/ docs/spec.md 2.2「リアルタイム双方向プレビュー」:
  // HTML内のテンプレート変数 {{key}} を、JSON入力エディタの値で置換してから描画する。
  // これによりJSON入力を編集すると、該当箇所（例: {{customer_name}} → モック太郎）が
  // プレビューに即時反映される。jsonContentはZustandストア経由で1文字ごとに更新されるため、
  // 別途の再描画（/api/render）を待たずにリアルタイム連動する。
  const renderedHtml = renderTemplate(htmlContent, jsonContent)

  // cssContentは/api/renderのレスポンスから来る（docs/spec.md 3.1）。<style>として末尾に足すだけで
  // <head>の有無に関わらず適用されるため、htmlの構造を解析・書き換えする必要がない。cssContentが
  // 空のとき（ステップ4時点の挙動）はrenderedHtmlのみを使い、既存の見た目を変えない。
  const srcDoc = cssContent ? `${renderedHtml}\n<style>${cssContent}</style>` : renderedHtml

  // 用紙サイズ。手動入力等で未指定（null）のときはA4たてを既定にする。
  const paperWidthMm = widthMm ?? SIZE_PRESETS.A4.yoko
  const paperHeightMm = heightMm ?? SIZE_PRESETS.A4.tate

  // iframe（＝ページ）の実寸ピクセル。ここでHTMLが用紙どおりの幅で組版される。
  const pageWidthPx = paperWidthMm * PX_PER_MM
  const pageHeightPx = paperHeightMm * PX_PER_MM

  // ステップ22b: ズーム倍率。拡大表示（expanded）中のみ操作可能で、収縮すると次回のために1へ戻す
  // （閉じたときのズーム状態を持ち越すと、次に開いたときに用紙の一部しか見えず戸惑うため）。
  // useEffectでのリセットは「エフェクト内での直接setState」（react-hooks/set-state-in-effectが
  // 警告する不要な再レンダーの連鎖）になるため、Reactが推奨するレンダー中の調整パターン
  // （前回のexpandedをstateとして持ち、変化を検知した回のレンダー中にstateを更新する）を使う。
  const [zoomLevel, setZoomLevel] = useState(1)
  const [prevExpanded, setPrevExpanded] = useState(expanded)
  if (expanded !== prevExpanded) {
    setPrevExpanded(expanded)
    if (!expanded) setZoomLevel(1)
  }

  // 表示領域（コンテナ）の実寸をResizeObserverで測り、ページを縦横比を保ったまま収める倍率を求める。
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
    // 拡大/縮小で利用可能領域が変わるため依存に含めて測り直す（用紙サイズはページpx側に反映済み）。
  }, [expanded])

  // ページを表示領域に収める倍率（contain）。幅・高さのうち厳しい方に合わせる。
  // 未測定（0）の間は0にしておき、レイアウト確定後に正しい倍率へ更新する（初回描画のちらつきを防ぐ）。
  const fitScale =
    container.width > 0 && container.height > 0
      ? Math.min(container.width / pageWidthPx, container.height / pageHeightPx)
      : 0
  // 実際に適用する倍率（収めるスケール × ズーム倍率）。zoomLevelは既定1（収めるだけ）で、
  // 拡大表示中のズーム操作でfitScaleを超えて拡大できるようにする。
  const scale = fitScale * zoomLevel
  // スケール後の実表示サイズ。クリック領域と見た目のページ枠をこの寸法に合わせる。
  const displayWidth = pageWidthPx * scale
  const displayHeight = pageHeightPx * scale
  // ズームで用紙が表示領域からはみ出しているか（コンテナのスクロール・寄せ挙動の分岐に使う）。
  const isZoomedBeyondFit = zoomLevel > 1

  const zoomIn = () => setZoomLevel((prev) => Math.min(ZOOM_MAX, Number((prev + ZOOM_STEP).toFixed(2))))
  const zoomOut = () => setZoomLevel((prev) => Math.max(ZOOM_MIN, Number((prev - ZOOM_STEP).toFixed(2))))
  const resetZoom = () => setZoomLevel(1)

  // ステップ21: まだ描画・入力していない空の状態。用紙が真っ白なだけだと「準備中/壊れている」と
  // 誤解されやすいため、プレースホルダ（アイコン＋説明）を用紙の上に薄く重ねて用途を示す。
  const isEmpty = htmlContent.trim() === '' && cssContent.trim() === ''

  return (
    // ステップ20: モバイル(md未満)ではflex-1の高さの元になる祖先の固定高さが無いため、
    // min-h-[50vh]で表示領域を確保する。md以上は既存どおりflex-1で残り高さいっぱいに広げる。
    // ステップ22b: relativeにし、ズーム操作パネルをスクロールする内側コンテナ（containerRef）の
    // 「外」に絶対配置する。内側に置くとズームで拡大したページの右下端（＝スクロールしないと
    // 見えない位置）に固定されてしまい、ズームを戻す手段そのものが見えなくなるため。
    <div className="relative flex min-h-[50vh] md:min-h-0 md:flex-1">
      <div
        ref={containerRef}
        // ステップ22b: ズームで用紙が表示領域よりはみ出す間は、overflow-autoでスクロールできるように
        // し、かつflexの中央寄せ（items-center/justify-center）を外す。中央寄せのままoverflow-autoに
        // すると、はみ出した領域のうち中心から見て手前側（左・上）へスクロールで到達できない
        // ブラウザ挙動があるため、ズーム中は開始位置（左上）基準の配置に切り替える。
        className={`flex h-full w-full ${
          isZoomedBeyondFit ? 'items-start justify-start overflow-auto' : 'items-center justify-center overflow-hidden'
        }`}
      >
        {/* ページ枠自体を押下領域にして拡大/縮小をトグルする。role="button"のdivにしているのは、
            ネイティブ<button>だとHTML仕様上、子要素に<button>（帳票内へは置かないが、将来の
            ズーム操作追加等を見越して制約を避ける）を入れ子にできないため。キーボード操作
            （Enter/Space）は自前でハンドリングする。iframeはpointer-events-noneにしてクリックを
            このdiv側へ通す（帳票内リンクではなく「拡大」操作として扱う）。 */}
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
          // 表示ページと同じ寸法にする（用紙比率を保った収まりサイズ）。未測定の間は100%で仮表示する。
          // ズーム中ははみ出しを許容するためshrink-0にし、コンテナのoverflow-autoでスクロールさせる。
          style={{ width: displayWidth || '100%', height: displayHeight || '100%' }}
          className="group relative shrink-0 overflow-hidden rounded-md border border-input bg-white shadow-sm ring-0 transition-all hover:border-ring hover:shadow-md"
        >
          <iframe
            title="プレビュー"
            srcDoc={srcDoc}
            tabIndex={-1}
            className="pointer-events-none border-0 bg-white"
            // iframeは常に用紙実寸(px)で組版し、左上基点でscaleして表示領域に収める。
            // これにより用紙サイズ変更・プレビュー拡大・ズームのいずれでも中身(HTML)の比率がそのまま追従する。
            style={{
              width: pageWidthPx,
              height: pageHeightPx,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
          {/* 空状態プレースホルダ。iframeの上に薄く重ねる。クリックは親divへ通すためpointer-events-none。 */}
          {isEmpty && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/70"
            >
              <FileText className="size-8" strokeWidth={1.5} />
              <span className="text-xs">描画するとここに帳票が表示されます</span>
            </div>
          )}
          {/* 拡大/縮小アイコン。右上に控えめに置き、ホバーで明確化する（押下で親divがトグル）。 */}
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md border border-input bg-background/85 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100"
          >
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </span>
        </div>
      </div>
      {/* ステップ22b: ズーム操作。拡大表示（expanded）中のみ表示する。スクロールする
          containerRefの外（この最上位divの直下）に絶対配置することで、ズームでページが
          はみ出してスクロールしても、表示領域の右下に常に留まり続ける。 */}
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
          {/* 現在のズーム率の表示のみ（非インタラクティブ）。リセットは末尾のRotateCcwボタンで行う。 */}
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
