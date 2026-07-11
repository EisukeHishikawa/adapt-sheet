import { Pencil } from 'lucide-react'
import { useSheetStore } from '@/store/sheetStore'

// ステップ8: docs/spec.md 2.2「履歴スライド機能」のUI。
// 過去の描画結果（最大10件、ストア側で管理）を新しい順に横並びで表示し、
// クリックでその内容をプレビューへ復元する。横スクロール（overflow-x-auto）で
// 件数が増えても画面幅に収まるようスライド表示にする。
// ステップ21:
//   - 履歴クリックで失われた「編集中」の未保存入力へ戻す専用カードを先頭に追加した（draft）。
//   - 見出し（ラベル）とサムネイルのホバー/選択の質感（拡大・リング）を整えた。
export function HistorySlider() {
  const history = useSheetStore((state) => state.history)
  const restoreFromHistory = useSheetStore((state) => state.restoreFromHistory)
  const draft = useSheetStore((state) => state.draft)
  const restoreDraft = useSheetStore((state) => state.restoreDraft)

  // 履歴もドラフトも無いときはスライダ自体を出さず、代わりに軽いプレースホルダのみ表示する
  // （まだ描画していないことをユーザーに伝える）。
  if (history.length === 0 && !draft) {
    return (
      <p className="px-1 py-3 text-xs text-muted-foreground">
        描画すると、ここに履歴が最大10件まで並びます
      </p>
    )
  }

  return (
    <div className="py-2">
      {/* 見出し。履歴カード群が何かを一目で示す小さなラベル。 */}
      <p className="mb-1.5 px-0.5 text-[11px] font-medium tracking-wide text-muted-foreground/80">
        履歴
      </p>
      <div className="flex gap-2.5 overflow-x-auto pb-1" aria-label="描画履歴">
        {/* ステップ21: 「編集中」カード。履歴クリック直前に退避した未保存入力へ戻す導線。
            サムネイルではなく編集アイコン＋ラベルの点線枠にして、描画済み履歴と視覚的に区別する。 */}
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

        {history.map((entry, index) => {
          // PreviewPanelと同じ方法でhtml+cssを合成し、当時の見た目をそのままサムネイル化する。
          const srcDoc = entry.css ? `${entry.html}\n<style>${entry.css}</style>` : entry.html
          return (
            <button
              // keyは位置(index)ではなく描画ごとに一意なseqにする（削除・並び替えでの再利用を避ける）。
              key={entry.seq}
              type="button"
              // 番号は位置ではなく描画ごとの通し番号(seq)を用いる。10を超えても振り直さず、
              // 大きいほど新しい描画を表す（ユーザー要望）。復元は配列位置(index)で引く。
              aria-label={`履歴 ${entry.seq}`}
              onClick={() => restoreFromHistory(index)}
              className="group relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-input bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-ring hover:shadow-md focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {/* iframeはpointer-events-noneにして、クリックを親button側へ通す
                  （サムネイル内のリンク等ではなく「履歴選択」として扱うため）。 */}
              <iframe
                title={`履歴プレビュー ${entry.seq}`}
                srcDoc={srcDoc}
                className="pointer-events-none h-full w-full"
                tabIndex={-1}
              />
              {/* 通し番号バッジ。ホバー時にわずかに濃くして「押せる」ことを補強する。 */}
              <span className="absolute bottom-1 right-1 rounded bg-foreground/70 px-1 text-[10px] font-medium text-background transition-colors group-hover:bg-foreground/85">
                {entry.seq}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
