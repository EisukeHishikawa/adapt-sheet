import { useLayoutEffect, useRef, useState } from 'react'
import { SIZE_PRESETS, useSheetStore } from '@/store/sheetStore'

// 左カラム下部のリアルタイムプレビュー。iframeを使うのは、生成されたHTML/CSSを
// 親ページのスタイルから隔離した状態で描画し、帳票の見た目をそのまま確認できるようにするため
// （docs/spec.md 2.1「HTMLプレビュー表示エリア」）。
// ステップ18で以下を実現している：
//   - サイズ（widthMm/heightMm）に合わせてプレビューの縦横比を変える（用紙の向きが一目でわかる）。
//   - プレビューを押下すると左カラム全体へ拡大表示する（expanded、App側で他要素を隠して実現）。
//   - iframeを「用紙の実寸(px)」で組版し、表示領域に収まるよう全体をscaleで拡大縮小する。
//     こうすると用紙サイズの変更やプレビュー拡大に伴って中身(HTML)の比率もそのまま追従する
//     （枠だけ変えて中身を流し込み直すのではなく、ページをズームする挙動）。
type PreviewPanelProps = {
  // 拡大表示中かどうか。表示自体はApp側のレイアウトで制御し、ここでは押下時のラベル切り替えに使う。
  expanded: boolean
  // プレビュー押下で拡大/縮小をトグルするハンドラ（状態はApp側が保持）。
  onToggleExpand: () => void
}

// 用紙の実寸(mm)をCSSピクセルへ換算する係数（96dpi基準: 1inch=25.4mm=96px）。
// これでiframeを「A4なら約794×1123px」といった実寸ページとして組版し、後段でscaleして収める。
const PX_PER_MM = 96 / 25.4

export function PreviewPanel({ expanded, onToggleExpand }: PreviewPanelProps) {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const cssContent = useSheetStore((state) => state.cssContent)
  const widthMm = useSheetStore((state) => state.widthMm)
  const heightMm = useSheetStore((state) => state.heightMm)

  // cssContentは/api/renderのレスポンスから来る（docs/spec.md 3.1）。<style>として末尾に足すだけで
  // <head>の有無に関わらず適用されるため、htmlの構造を解析・書き換えする必要がない。cssContentが
  // 空のとき（ステップ4時点の挙動）はhtmlContentのみを使い、既存の見た目を変えない。
  const srcDoc = cssContent ? `${htmlContent}\n<style>${cssContent}</style>` : htmlContent

  // 用紙サイズ。手動入力等で未指定（null）のときはA4たてを既定にする。
  const paperWidthMm = widthMm ?? SIZE_PRESETS.A4.yoko
  const paperHeightMm = heightMm ?? SIZE_PRESETS.A4.tate

  // iframe（＝ページ）の実寸ピクセル。ここでHTMLが用紙どおりの幅で組版される。
  const pageWidthPx = paperWidthMm * PX_PER_MM
  const pageHeightPx = paperHeightMm * PX_PER_MM

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
  const scale =
    container.width > 0 && container.height > 0
      ? Math.min(container.width / pageWidthPx, container.height / pageHeightPx)
      : 0
  // スケール後の実表示サイズ。クリック領域（button）と見た目のページ枠をこの寸法に合わせる。
  const displayWidth = pageWidthPx * scale
  const displayHeight = pageHeightPx * scale

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      {/* ページ枠自体を押下ボタンにして拡大/縮小をトグルする。iframeはpointer-events-noneにして
          クリックを親button側へ通す（帳票内リンクではなく「拡大」操作として扱う）。 */}
      <button
        type="button"
        aria-label={expanded ? 'プレビューを縮小' : 'プレビューを拡大'}
        onClick={onToggleExpand}
        // 表示ページと同じ寸法にする（用紙比率を保った収まりサイズ）。未測定の間は100%で仮表示する。
        style={{ width: displayWidth || '100%', height: displayHeight || '100%' }}
        className="relative overflow-hidden rounded-md border border-input bg-white transition-colors hover:border-ring"
      >
        <iframe
          title="プレビュー"
          srcDoc={srcDoc}
          tabIndex={-1}
          className="pointer-events-none border-0 bg-white"
          // iframeは常に用紙実寸(px)で組版し、左上基点でscaleして表示領域に収める。
          // これにより用紙サイズ変更・プレビュー拡大のいずれでも中身(HTML)の比率がそのまま追従する。
          style={{
            width: pageWidthPx,
            height: pageHeightPx,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        />
      </button>
    </div>
  )
}
