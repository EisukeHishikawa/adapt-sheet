import { History as HistoryIcon, Loader2, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { HistoryItemResponse, HistoryQuery } from '@/lib/api'
import { deleteHistory, getHistory } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useSheetStore } from '@/store/sheetStore'

const KIND_LABEL: Record<string, string> = { edit: '編集中', render: '描画結果' }

// 1回の取得件数。サーバー側の既定（backend/app/services/history.DEFAULT_HISTORY_PAGE_SIZE）と揃える。
const PAGE_SIZE = 20
// 入力の途中で毎文字リクエストしないための待ち時間。
const SEARCH_DEBOUNCE_MS = 300

const KIND_FILTERS = [
  { value: 'all', label: 'すべて' },
  { value: 'render', label: '描画結果' },
  { value: 'edit', label: '編集中' },
] as const

type KindFilter = (typeof KIND_FILTERS)[number]['value']

// 保存済み履歴を画面上で閲覧・復元・削除するUI。
// HistorySlider（クライアント側・最大MAX_HISTORY_LENGTH件）の枠外にある過去データは、
// 開いたときにだけGET /api/historyから取り直して一覧表示する（常時保持はしない）。
// 履歴が増えても全件は読まず、キーワード・種類での絞り込みと1ページ分ずつの追加取得を
// サーバー側に任せる。
export function HistoryArchive() {
  const isAuthAvailable = useAuthStore((state) => state.isAuthAvailable)
  const session = useAuthStore((state) => state.session)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<HistoryItemResponse[]>([])
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // 検索条件を続けて変えたとき、古いリクエストの応答で新しい結果を上書きしないための世代番号。
  const requestSeq = useRef(0)

  const accessToken = session?.access_token ?? null

  const fetchPage = useCallback(
    (condition: HistoryQuery) => {
      if (!accessToken) return Promise.resolve<HistoryItemResponse[] | null>(null)
      const seq = ++requestSeq.current
      return getHistory(accessToken, { ...condition, limit: PAGE_SIZE }).then((rows) =>
        seq === requestSeq.current ? rows : null,
      )
    },
    [accessToken],
  )

  const kindParam = kindFilter === 'all' ? undefined : kindFilter

  useEffect(() => {
    if (!isOpen || !accessToken) return

    // 開いた直後・種類変更は待たずに取得し、キーワード入力中だけ打鍵が止まるのを待つ。
    const delay = query.trim() ? SEARCH_DEBOUNCE_MS : 0
    const timer = setTimeout(() => {
      setIsLoading(true)
      setError(null)
      setDeleteError(null)
      setPendingDeleteId(null)
      fetchPage({ q: query, kind: kindParam })
        .then((rows) => {
          if (rows === null) return
          setItems(rows)
          setHasMore(rows.length === PAGE_SIZE)
          setIsLoading(false)
        })
        .catch(() => {
          setError('過去データの取得に失敗しました。')
          setIsLoading(false)
        })
    }, delay)

    return () => clearTimeout(timer)
  }, [isOpen, accessToken, query, kindParam, fetchPage])

  // GET /api/historyはログイン必須のため、未ログイン時は導線を出さない。
  if (!isAuthAvailable || !session) return null

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (open) return
    setQuery('')
    setKindFilter('all')
    setItems([])
  }

  const handleSelect = (row: HistoryItemResponse) => {
    useSheetStore.getState().restoreFromServerEntry(row)
    setIsOpen(false)
  }

  const handleLoadMore = () => {
    setIsLoadingMore(true)
    setError(null)
    fetchPage({ q: query, kind: kindParam, offset: items.length })
      .then((rows) => {
        if (rows === null) return
        setItems((current) => [...current, ...rows])
        setHasMore(rows.length === PAGE_SIZE)
      })
      .catch(() => setError('過去データの取得に失敗しました。'))
      .finally(() => setIsLoadingMore(false))
  }

  const handleDelete = (row: HistoryItemResponse) => {
    setDeleteError(null)
    deleteHistory(row.id, session.access_token)
      .then(() => {
        setItems((current) => current.filter((item) => item.id !== row.id))
        setPendingDeleteId(null)
      })
      .catch(() => setDeleteError('履歴の削除に失敗しました。'))
  }

  const isFiltered = Boolean(query.trim()) || kindFilter !== 'all'

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
            <DialogClose aria-label="閉じる" className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}>
              <X aria-hidden="true" />
            </DialogClose>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="帳票の文字・データで検索"
                aria-label="過去データを検索"
                className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <fieldset className="flex gap-1" aria-label="種類で絞り込む">
              {KIND_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={kindFilter === filter.value}
                  onClick={() => setKindFilter(filter.value)}
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-[11px]',
                    kindFilter === filter.value
                      ? 'border-ring bg-muted font-medium text-foreground'
                      : 'border-input text-muted-foreground hover:bg-muted',
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </fieldset>
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
          {deleteError && (
            <p role="alert" className="text-xs text-destructive">
              {deleteError}
            </p>
          )}
          {!isLoading && !error && items.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {isFiltered ? '条件に一致する履歴はありません。' : '保存された履歴はまだありません。'}
            </p>
          )}
          {!isLoading && !error && items.length > 0 && (
            <ul className="flex flex-col gap-1">
              {items.map((row) => (
                <li key={row.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleSelect(row)}
                    className="flex flex-1 items-center justify-between gap-2 rounded-md border border-input px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    <span>{new Date(row.created_at).toLocaleString('ja-JP')}</span>
                    <span className="text-muted-foreground">{KIND_LABEL[row.kind] ?? row.kind}</span>
                  </button>
                  {pendingDeleteId === row.id ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        className={cn(buttonVariants({ variant: 'destructive', size: 'sm' }), 'h-7 px-2 text-[11px]')}
                      >
                        削除する
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(null)}
                        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-7 px-2 text-[11px]')}
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`${new Date(row.created_at).toLocaleString('ja-JP')}の履歴を削除`}
                      onClick={() => {
                        setDeleteError(null)
                        setPendingDeleteId(row.id)
                      }}
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
                        'shrink-0 text-muted-foreground hover:text-destructive',
                      )}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!isLoading && !error && hasMore && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-center text-xs')}
            >
              {isLoadingMore ? '読み込み中...' : 'さらに読み込む'}
            </button>
          )}
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
