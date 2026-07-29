import { Pencil } from 'lucide-react'
import { dimensionsFor, useSheetStore } from '@/store/sheetStore'
import { composePreviewDocument, renderTemplate } from '@/lib/template'
import { cn } from '@/lib/utils'
import { HistoryArchive } from '@/components/HistoryArchive'

// 96dpi基準（1inch = 25.4mm = 96px）で用紙の実寸(mm)をCSSピクセルへ換算する。PreviewPanelと同じ換算式。
const PX_PER_MM = 96 / 25.4
const DEFAULT_DIMENSIONS = dimensionsFor('A4', 'tate')

// サムネイル枠(h-24 w-20)の内寸px。ページ実寸をこの枠に収まるscaleへ変換する。
const THUMBNAIL_WIDTH_PX = 80
const THUMBNAIL_HEIGHT_PX = 96

// docs/spec.md 2.2「履歴スライド機能」のUI。描画結果と編集中スナップショットを新しい順に
// 横並びで表示し、クリックでプレビューへ復元する。編集中は描画を経ていないことが一目で分かるよう、
// 点線枠と鉛筆バッジで描画結果と区別する。ヘッダー行のHistoryArchiveは、この最大10件枠の
// 外にある過去データを見るための導線で、履歴が空の間も表示する。
export function HistorySlider() {
  const history = useSheetStore((state) => state.history)
  const restoreFromHistory = useSheetStore((state) => state.restoreFromHistory)

  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground/80">履歴</p>
        <HistoryArchive />
      </div>
      {history.length === 0 ? (
        <p className="px-0.5 pb-1 text-xs text-muted-foreground">
          描画・編集すると、ここに履歴が最大10件まで並びます
        </p>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-1" aria-label="描画履歴">
          {history.map((entry, index) => {
            const isEdit = entry.kind === 'edit'
            // entry.widthMm/heightMmが無い（サイズ未指定の古い履歴等）場合はPreviewPanelと同じA4縦を既定にする。
            const pageWidthPx = (entry.widthMm ?? DEFAULT_DIMENSIONS.widthMm) * PX_PER_MM
            const pageHeightPx = (entry.heightMm ?? DEFAULT_DIMENSIONS.heightMm) * PX_PER_MM
            // ページ実寸のままiframeへ渡すと枠の左上しか映らないため、PreviewPanelと同様に
            // 枠に収まるscaleへtransformし、ページ全体の縮小表示にする。
            const scale = Math.min(THUMBNAIL_WIDTH_PX / pageWidthPx, THUMBNAIL_HEIGHT_PX / pageHeightPx)
            return (
              <button
                // keyと表示番号は位置(index)ではなく一意なseqを使う（削除で番号が振り直されないため）。
                // 復元は配列位置で引く。
                key={entry.seq}
                type="button"
                aria-label={isEdit ? `編集中 ${entry.seq}` : `履歴 ${entry.seq}`}
                onClick={() => restoreFromHistory(index)}
                className={cn(
                  'group relative h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-ring hover:shadow-md focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  isEdit ? 'border border-dashed border-ring/60' : 'border border-input',
                )}
              >
                {/* pointer-events-noneで、サムネイル内のリンクではなく親button（履歴選択）へクリックを通す。 */}
                <iframe
                  title={isEdit ? `編集中プレビュー ${entry.seq}` : `履歴プレビュー ${entry.seq}`}
                  // entry.htmlは{{key}}を含んだままのHTMLで実際の値はentry.json側にあるため、
                  // プレビュー本体と同じくrenderTemplateで置換してからサムネイル化する。
                  srcDoc={composePreviewDocument(renderTemplate(entry.html, entry.json), entry.css)}
                  className="pointer-events-none absolute left-0 top-0 border-0"
                  style={{
                    width: pageWidthPx,
                    height: pageHeightPx,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                  }}
                  tabIndex={-1}
                />
                {isEdit && (
                  <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-ring/85 px-1 py-0.5 text-[9px] font-medium leading-none text-background">
                    <Pencil className="size-2.5" />
                    編集中
                  </span>
                )}
                <span className="absolute bottom-1 right-1 rounded bg-foreground/70 px-1 text-[10px] font-medium text-background transition-colors group-hover:bg-foreground/85">
                  {entry.seq}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
