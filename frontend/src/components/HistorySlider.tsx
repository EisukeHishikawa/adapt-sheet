import { useSheetStore } from '@/store/sheetStore'

// ステップ8: docs/spec.md 2.2「履歴スライド機能」のUI。
// 過去の描画結果（最大10件、ストア側で管理）を新しい順に横並びで表示し、
// クリックでその内容をプレビューへ復元する。横スクロール（overflow-x-auto）で
// 件数が増えても画面幅に収まるようスライド表示にする。
export function HistorySlider() {
  const history = useSheetStore((state) => state.history)
  const restoreFromHistory = useSheetStore((state) => state.restoreFromHistory)

  // 履歴が空のときはスライダ自体を出さず、代わりに軽いプレースホルダのみ表示する
  // （まだ描画していないことをユーザーに伝える）。
  if (history.length === 0) {
    return (
      <p className="px-1 py-2 text-xs text-muted-foreground">
        描画すると、ここに履歴が最大10件まで並びます
      </p>
    )
  }

  return (
    <div className="flex gap-2 overflow-x-auto py-2" aria-label="描画履歴">
      {history.map((entry, index) => {
        // PreviewPanelと同じ方法でhtml+cssを合成し、当時の見た目をそのままサムネイル化する。
        const srcDoc = entry.css ? `${entry.html}\n<style>${entry.css}</style>` : entry.html
        return (
          <button
            key={index}
            type="button"
            // aria-labelは「履歴 1」（＝最新）から始まる連番にして、スクリーンリーダーや
            // E2Eテストから順序込みで一意に選択できるようにする。
            aria-label={`履歴 ${index + 1}`}
            onClick={() => restoreFromHistory(index)}
            className="relative h-24 w-20 shrink-0 overflow-hidden rounded-md border border-input bg-white transition-colors hover:border-ring"
          >
            {/* iframeはpointer-events-noneにして、クリックを親button側へ通す
                （サムネイル内のリンク等ではなく「履歴選択」として扱うため）。 */}
            <iframe
              title={`履歴プレビュー ${index + 1}`}
              srcDoc={srcDoc}
              className="pointer-events-none h-full w-full"
              tabIndex={-1}
            />
            <span className="absolute bottom-0 right-0 bg-foreground/70 px-1 text-[10px] text-background">
              {index + 1}
            </span>
          </button>
        )
      })}
    </div>
  )
}
