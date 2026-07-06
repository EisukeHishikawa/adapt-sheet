import { create } from 'zustand'
import { renderSheet } from '@/lib/api'

// 2カラム画面（左：入力エディタ / 右：プレビュー）を疎結合に連動させるためのグローバルストア。
// props経由のバケツリレーを避け、どのコンポーネントからも同じ状態を参照・更新できるようにする。
// ステップ5で「描画ボタン→API疎通」を追加するため、レスポンスのcss/json、
// 通信中/エラー状態も併せて持たせる。
// ステップ7でPDFドラッグ＆ドロップ（docs/spec.md 2.1 ファイル操作）に対応するため、
// アップロード済みPDFをpdfFile/pdfFileNameとして持たせる。実体（File）とファイル名を分けるのは、
// PreviewPanel等ではファイル名の表示のみ必要でFileオブジェクト自体は不要なケースがあるため。
type SheetState = {
  htmlContent: string
  cssContent: string
  jsonContent: Record<string, unknown>
  pdfFile: File | null
  pdfFileName: string | null
  isLoading: boolean
  error: string | null
  setHtmlContent: (html: string) => void
  setPdfFile: (file: File | null) => void
  fetchRender: () => Promise<void>
}

export const useSheetStore = create<SheetState>((set, get) => ({
  htmlContent: '',
  cssContent: '',
  jsonContent: {},
  pdfFile: null,
  pdfFileName: null,
  isLoading: false,
  error: null,
  setHtmlContent: (html) => set({ htmlContent: html }),
  setPdfFile: (file) => set({ pdfFile: file, pdfFileName: file?.name ?? null }),
  fetchRender: async () => {
    set({ isLoading: true, error: null })
    try {
      // 現時点のエディタ内容（htmlContent）とPDF（pdfFile、あれば）をリクエストとして送り、
      // レスポンスでストアの表示内容を丸ごと置き換える（docs/spec.md 3.1）。
      const { htmlContent, pdfFile } = get()
      const result = await renderSheet({
        html: htmlContent,
        pdf: pdfFile ?? undefined,
      })
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
