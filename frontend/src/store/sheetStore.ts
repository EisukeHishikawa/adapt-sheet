import { create } from 'zustand'
import { RenderApiError, renderSheet } from '@/lib/api'

// 2カラム画面（左：入力エディタ / 右：プレビュー）を疎結合に連動させるためのグローバルストア。
// props経由のバケツリレーを避け、どのコンポーネントからも同じ状態を参照・更新できるようにする。
// ステップ5で「描画ボタン→API疎通」を追加するため、レスポンスのcss/json、
// 通信中/エラー状態も併せて持たせる。
// ステップ7でPDFドラッグ＆ドロップ（docs/spec.md 2.1 ファイル操作）に対応するため、
// アップロード済みPDFをpdfFile/pdfFileNameとして持たせる。実体（File）とファイル名を分けるのは、
// PreviewPanel等ではファイル名の表示のみ必要でFileオブジェクト自体は不要なケースがあるため。

// ステップ8: docs/spec.md 2.2「定型サイズ自動入力」の寸法表。
// 表のカラム見出し「たて (mm)」「よこ (mm)」をそのままキー名(tate/yoko)にして、
// 仕様書とコードの対応関係を1対1で追えるようにする。tateは長辺、yokoは短辺。
export const SIZE_PRESETS = {
  A4: { tate: 297, yoko: 210 },
  A5: { tate: 210, yoko: 148 },
  B5: { tate: 257, yoko: 182 },
} as const

export type SizePresetName = keyof typeof SIZE_PRESETS
export type Orientation = 'tate' | 'yoko'

// ステップ8: 履歴スライド機能（docs/spec.md 2.2）で表示・保持する1件分の描画結果。
// 再描画のたびにこの型のスナップショットをhistoryの先頭へ積む。サイズ（widthMm/heightMm）も
// 含めるのは、履歴サムネイルを当時の縦横比で表示し直せるようにするため。
export type HistoryEntry = {
  html: string
  css: string
  json: Record<string, unknown>
  widthMm: number | null
  heightMm: number | null
}

// docs/spec.md 2.2「履歴スライド機能」: 最大10件までスタックし、11件目以降は最古を破棄する。
const MAX_HISTORY_LENGTH = 10

// docs/spec.md 4章のエラーコード定義に沿った、ユーザー向けの日本語メッセージ。
// バックエンドの例外メッセージ（英語や技術的な詳細を含みうる）をそのまま出さず、
// ステータスコード単位で固定文言に丸めることで、ユーザーに次のアクション（再試行/入力確認等）を
// 明確に伝える。定義外のステータスは500系の想定外エラーとして扱う。
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'リクエスト内容に誤りがあります。入力値をご確認ください。'
    case 413:
      return 'PDFファイルのサイズが上限を超えています。'
    case 422:
      return 'PDFの解析に失敗しました。ファイルの内容をご確認ください。'
    case 429:
      return 'リクエストが混み合っています。しばらくしてから再度お試しください。'
    case 502:
      return 'AIによる生成に失敗しました。しばらくしてから再度お試しください。'
    default:
      return 'サーバーで想定外のエラーが発生しました。'
  }
}

type SheetState = {
  htmlContent: string
  cssContent: string
  jsonContent: Record<string, unknown>
  pdfFile: File | null
  pdfFileName: string | null
  // ステップ8: 縦幅・横幅サイズ入力（docs/spec.md 2.1「コントロール」）。
  // nullは「未入力」を表し、fetchRenderではAPIへ送らない（Optional[float] = Form(None)と対応）。
  widthMm: number | null
  heightMm: number | null
  history: HistoryEntry[]
  isLoading: boolean
  error: string | null
  // ステップ8: docs/spec.md 2.2「インテリジェントメッセージ表示」の成功メッセージ側。
  // エラーと同様にトースト表示用の文言のみを保持し、表示形式（Toastコンポーネント）とは分離する。
  successMessage: string | null
  setHtmlContent: (html: string) => void
  setPdfFile: (file: File | null) => void
  setWidthMm: (widthMm: number | null) => void
  setHeightMm: (heightMm: number | null) => void
  applySizePreset: (size: SizePresetName, orientation: Orientation) => void
  restoreFromHistory: (index: number) => void
  dismissError: () => void
  dismissSuccessMessage: () => void
  fetchRender: () => Promise<void>
}

export const useSheetStore = create<SheetState>((set, get) => ({
  htmlContent: '',
  cssContent: '',
  jsonContent: {},
  pdfFile: null,
  pdfFileName: null,
  widthMm: null,
  heightMm: null,
  history: [],
  isLoading: false,
  error: null,
  successMessage: null,
  setHtmlContent: (html) => set({ htmlContent: html }),
  setPdfFile: (file) => set({ pdfFile: file, pdfFileName: file?.name ?? null }),
  setWidthMm: (widthMm) => set({ widthMm }),
  setHeightMm: (heightMm) => set({ heightMm }),
  // docs/spec.md 2.2「定型サイズ自動入力」: 「たて」（ポートレート）は短辺(yoko)が幅・長辺(tate)が高さ。
  // 「よこ」（ランドスケープ）は用紙を90度回した状態なので、幅と高さが入れ替わる。
  applySizePreset: (size, orientation) => {
    const preset = SIZE_PRESETS[size]
    if (orientation === 'tate') {
      set({ widthMm: preset.yoko, heightMm: preset.tate })
    } else {
      set({ widthMm: preset.tate, heightMm: preset.yoko })
    }
  },
  // docs/spec.md 2.2「履歴スライド機能」: 履歴サムネイルの選択で、その時点の描画結果を
  // プレビュー（htmlContent/cssContent/jsonContent）へ復元する。範囲外indexは無視する。
  restoreFromHistory: (index) => {
    const entry = get().history[index]
    if (!entry) return
    set({
      htmlContent: entry.html,
      cssContent: entry.css,
      jsonContent: entry.json,
      widthMm: entry.widthMm,
      heightMm: entry.heightMm,
    })
  },
  dismissError: () => set({ error: null }),
  dismissSuccessMessage: () => set({ successMessage: null }),
  fetchRender: async () => {
    // 前回の描画で表示していたメッセージを、新しいリクエスト開始時点で消しておく。
    // 消さないと「エラー→再試行→通信中でもまだ前回のエラー文言が残る」という
    // ユーザーに誤解を与える表示になってしまうため。
    set({ isLoading: true, error: null, successMessage: null })
    try {
      // 現時点のエディタ内容（htmlContent）とPDF（pdfFile、あれば）、
      // サイズ指定（widthMm/heightMm、あれば）をリクエストとして送り、
      // レスポンスでストアの表示内容を丸ごと置き換える（docs/spec.md 3.1）。
      const { htmlContent, pdfFile, widthMm, heightMm } = get()
      const result = await renderSheet({
        html: htmlContent,
        pdf: pdfFile ?? undefined,
        width_mm: widthMm ?? undefined,
        height_mm: heightMm ?? undefined,
      })
      const jsonContent = result.json ?? {}
      // 描画時点のサイズも一緒にスナップショットしておく（後からwidthMmを変えても履歴は当時の値を保持）。
      const newEntry: HistoryEntry = {
        html: result.html,
        css: result.css,
        json: jsonContent,
        widthMm,
        heightMm,
      }
      set((state) => ({
        htmlContent: result.html,
        cssContent: result.css,
        jsonContent,
        isLoading: false,
        successMessage: '描画が完了しました',
        // 新しい履歴を先頭に積み、MAX_HISTORY_LENGTHを超えた分（最も古い履歴）は切り捨てる
        // （docs/spec.md 2.2「履歴スライド機能」: 11件目以降は最も古い履歴を破棄）。
        history: [newEntry, ...state.history].slice(0, MAX_HISTORY_LENGTH),
      }))
    } catch (err) {
      // RenderApiErrorならステータスコードに対応する文言、それ以外（ネットワーク断や
      // JSON解釈失敗など）は想定外エラー扱い（messageForStatusのdefault）にする。
      const message = err instanceof RenderApiError ? messageForStatus(err.status) : messageForStatus(0)
      set({
        error: message,
        successMessage: null,
        isLoading: false,
      })
    }
  },
}))
