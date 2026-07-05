import { create } from 'zustand'
import { renderSheet } from '@/lib/api'

// 2カラム画面（左：入力エディタ / 右：プレビュー）を疎結合に連動させるためのグローバルストア。
// props経由のバケツリレーを避け、どのコンポーネントからも同じ状態を参照・更新できるようにする。
// ステップ5で「描画ボタン→API疎通」を追加するため、レスポンスのcss/json、
// 通信中/エラー状態も併せて持たせる。
type SheetState = {
  htmlContent: string
  cssContent: string
  jsonContent: Record<string, unknown>
  isLoading: boolean
  error: string | null
  setHtmlContent: (html: string) => void
  fetchRender: () => Promise<void>
}

export const useSheetStore = create<SheetState>((set, get) => ({
  htmlContent: '',
  cssContent: '',
  jsonContent: {},
  isLoading: false,
  error: null,
  setHtmlContent: (html) => set({ htmlContent: html }),
  fetchRender: async () => {
    set({ isLoading: true, error: null })
    try {
      // 現時点のエディタ内容（htmlContent）をリクエストとして送り、
      // レスポンスでストアの表示内容を丸ごと置き換える（docs/spec.md 3.1）。
      const result = await renderSheet({ html: get().htmlContent })
      set({
        htmlContent: result.html,
        cssContent: result.css,
        jsonContent: result.json ?? {},
        isLoading: false,
      })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : '描画に失敗しました',
        isLoading: false,
      })
    }
  },
}))
