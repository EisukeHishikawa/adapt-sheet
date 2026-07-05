import { create } from 'zustand'

// 2カラム画面（左：入力エディタ / 右：プレビュー）を疎結合に連動させるためのグローバルストア。
// props経由のバケツリレーを避け、どのコンポーネントからも同じ状態を参照・更新できるようにする。
// ステップ4時点ではHTML入力のみの超最小構成とし、CSS/JSON/プロンプト等は今後のステップで拡張する。
type SheetState = {
  htmlContent: string
  setHtmlContent: (html: string) => void
}

export const useSheetStore = create<SheetState>((set) => ({
  htmlContent: '',
  setHtmlContent: (html) => set({ htmlContent: html }),
}))
