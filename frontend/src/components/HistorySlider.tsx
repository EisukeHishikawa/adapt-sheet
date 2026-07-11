import { Pencil } from 'lucide-react'
import { useSheetStore } from '@/store/sheetStore'
import { composePreviewDocument } from '@/lib/template'

// docs/spec.md 2.2「履歴スライド機能」のUI。過去の描画結果を新しい順に横並びで表示し、
// クリックでプレビューへ復元する。先頭の「編集中」カードは、履歴クリックで上書きされる直前の
// 未保存入力（draft）へ戻すための導線。
export function HistorySlider() {
  const history = useSheetStore((state) => state.history)
  const restoreFromHistory = useSheetStore((state) => state.restoreFromHistory)
  const draft = useSheetStore((state) => state.draft)
  const restoreDraft = useSheetStore((state) => state.restoreDraft)

  if (history.length === 0 && !draft) {
    return (
      <p className="px-1 py-3 text-xs text-muted-foreground">
        描画すると、ここに履歴が最大10件まで並びます
      </p>
    )
  }

  return (
    <div className="py-2">
      <p className="mb-1.5 px-0.5 text-[11px] font-medium tracking-wide text-muted-foreground/80">
        履歴
      </p>
      <div className="flex gap-2.5 overflow-x-auto pb-1" aria-label="描画履歴">
        {/* 描画済み履歴と視覚的に区別するため、サムネイルではなく点線枠のアイコンカードにする。 */}
        {draft && (
          <button
            type="button"
            aria-label="編集中の内容に戻す"
            onClick={restoreDraft}
            className="group flex h-24 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ring/60 bg-muted/40 text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-ring hover:text-foreground hover:shadow-sm"
          >
            <Pencil className="size-4" />
            <span className="text-[10px] font-medium leading-tight">編集中</span>
          </button>
        )}

        {history.map((entry, index) => (
          <button
            // keyと表示番号は位置(index)ではなく描画ごとに一意なseqを使う（削除で番号が振り直されないため）。
            // 復元は配列位置で引く。
            key={entry.seq}
            type="button"
            aria-label={`履歴 ${entry.seq}`}
            onClick={() => restoreFromHistory(index)}
            className="group relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-input bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-ring hover:shadow-md focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {/* pointer-events-noneで、サムネイル内のリンクではなく親button（履歴選択）へクリックを通す。 */}
            <iframe
              title={`履歴プレビュー ${entry.seq}`}
              srcDoc={composePreviewDocument(entry.html, entry.css)}
              className="pointer-events-none h-full w-full"
              tabIndex={-1}
            />
            <span className="absolute bottom-1 right-1 rounded bg-foreground/70 px-1 text-[10px] font-medium text-background transition-colors group-hover:bg-foreground/85">
              {entry.seq}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
