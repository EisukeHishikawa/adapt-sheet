import { useLayoutEffect, useRef, useState } from 'react'
import { SIZE_PRESETS, useSheetStore } from '@/store/sheetStore'

// 左カラム下部のリアルタイムプレビュー。iframeを使うのは、生成されたHTML/CSSを
// 親ページのスタイルから隔離した状態で描画し、帳票の見た目をそのまま確認できるようにするため
// （docs/spec.md 2.1「HTMLプレビュー表示エリア」）。
// ステップ18で以下を追加した：
//   - サイズ（widthMm/heightMm）に合わせてプレビューの縦横比を変える（用紙の向きが一目でわかる）。
//   - プレビューを押下すると左カラム全体へ拡大表示する（expanded、App側で他要素を隠して実現）。
type PreviewPanelProps = {
  // 拡大表示中かどうか。表示自体はApp側のレイアウトで制御し、ここでは押下時のラベル切り替えに使う。
  expanded: boolean
  // プレビュー押下で拡大/縮小をトグルするハンドラ（状態はApp側が保持）。
  onToggleExpand: () => void
}

export function PreviewPanel({ expanded, onToggleExpand }: PreviewPanelProps) {
  const htmlContent = useSheetStore((state) => state.htmlContent)
  const cssContent = useSheetStore((state) => state.cssContent)
  const widthMm = useSheetStore((state) => state.widthMm)
  const heightMm = useSheetStore((state) => state.heightMm)

  // cssContentは/api/renderのレスポンスから来る（docs/spec.md 3.1）。<style>として末尾に足すだけで
  // <head>の有無に関わらず適用されるため、htmlの構造を解析・書き換えする必要がない。cssContentが
  // 空のとき（ステップ4時点の挙動）はhtmlContentのみを使い、既存の見た目を変えない。
  const srcDoc = cssContent ? `${htmlContent}\n<style>${cssContent}</style>` : htmlContent

  // 用紙の縦横比。手動入力等でサイズ未指定（null）のときはA4たてを既定にする。
  const ratioW = widthMm ?? SIZE_PRESETS.A4.yoko
  const ratioH = heightMm ?? SIZE_PRESETS.A4.tate

  // プレビュー枠は「コンテナに収まる範囲で縦横比を保ったまま最大化」する。純CSSのaspect-ratioだけでは
  // 縦長・横長どちらのコンテナでも常にレターボックス表示にするのが難しい（片方の軸を固定すると
  // もう片方でアスペクト比が崩れる）ため、コンテナ実寸をResizeObserverで測って収まるサイズを計算する。
  const containerRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const measure = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      const ratio = ratioW / ratioH
      // まず幅いっぱいに広げ、はみ出すなら高さ基準に切り替える（contain相当の当てはめ）。
      let width = cw
      let height = cw / ratio
      if (height > ch) {
        height = ch
        width = ch * ratio
      }
      setBox({ width, height })
    }

    measure()
    // jsdom等ResizeObserver非対応環境では初回measureのみで打ち切る（テストはsrcDocのみ検証）。
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
    // 拡大/縮小や用紙サイズ変更で利用可能領域・比率が変わるため、それらを依存に含めて測り直す。
  }, [ratioW, ratioH, expanded])

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      {/* プレビュー枠自体を押下ボタンにして拡大/縮小をトグルする。iframeはpointer-events-noneにして
          クリックを親button側へ通す（帳票内リンクではなく「拡大」操作として扱う）。 */}
      <button
        type="button"
        aria-label={expanded ? 'プレビューを縮小' : 'プレビューを拡大'}
        onClick={onToggleExpand}
        // 測定済みサイズ（縦横比を保った収まりサイズ）を明示指定する。未測定（0）の間は
        // 100%にしておき、レイアウト確定後にResizeObserverで正しいサイズへ更新する。
        style={{ width: box.width || '100%', height: box.height || '100%' }}
        className="overflow-hidden rounded-md border border-input bg-white transition-colors hover:border-ring"
      >
        <iframe
          title="プレビュー"
          srcDoc={srcDoc}
          className="pointer-events-none h-full w-full"
          tabIndex={-1}
        />
      </button>
    </div>
  )
}
