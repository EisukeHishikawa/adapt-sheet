import { useState } from 'react'
import { History as HistoryIcon, Loader2, X } from 'lucide-react'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { buttonVariants } from '@/components/ui/button'
import { useAuthStore } from '@/store/authStore'
import { useSheetStore } from '@/store/sheetStore'
import { getHistory } from '@/lib/api'
import type { HistoryItemResponse } from '@/lib/api'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<string, string> = { edit: '編集中', render: '描画結果' }

// docs/spec.md 5章・ADR-019の残課題「保存済み履歴を画面上で閲覧・復元するUI」。
// HistorySlider（クライアント側・最大MAX_HISTORY_LENGTH件）の枠外にある過去データは、
// 開いたときにだけGET /api/historyから取り直して一覧表示する（常時保持はしない）。
export function HistoryArchive() {
  const isAuthAvailable = useAuthStore((state) => state.isAuthAvailable)
  const session = useAuthStore((state) => state.session)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<HistoryItemResponse[]>([])

  // GET /api/historyはログイン必須（backend/app/main.py get_history）のため、未ログイン時は
  // 押しても403になるだけの導線を出さない。
  if (!isAuthAvailable || !session) return null

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) return

    setIsLoading(true)
    setError(null)
    getHistory(session.access_token)
      .then((rows) => setItems(rows))
      .catch(() => setError('過去データの取得に失敗しました。'))
      .finally(() => setIsLoading(false))
  }

  const handleSelect = (row: HistoryItemResponse) => {
    useSheetStore.getState().restoreFromServerEntry(row)
    setIsOpen(false)
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
        <HistoryIcon aria-hidden="true" />
        過去データを見る
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup aria-label="過去データ">
          <div className="flex items-center justify-between">
            <DialogTitle>過去データ</DialogTitle>
            <DialogClose
              aria-label="閉じる"
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
            >
              <X aria-hidden="true" />
            </DialogClose>
          </div>

          {isLoading && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              読み込み中...
            </p>
          )}
          {!isLoading && error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {!isLoading && !error && items.length === 0 && (
            <p className="text-xs text-muted-foreground">保存された履歴はまだありません。</p>
          )}
          {!isLoading && !error && items.length > 0 && (
            <ul className="flex flex-col gap-1">
              {items.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(row)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-input px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <span>{new Date(row.created_at).toLocaleString('ja-JP')}</span>
                    <span className="text-muted-foreground">{KIND_LABEL[row.kind] ?? row.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
