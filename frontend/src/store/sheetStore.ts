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
// ステップ16: jsonはJSON入力エディタへそのまま復元できるよう、htmlContent/cssContentと同じく
// 生のテキスト（string）として保持する（パース済みオブジェクトでは編集不可のtextareaに戻せないため）。
export type HistoryEntry = {
  html: string
  css: string
  json: string
  widthMm: number | null
  heightMm: number | null
}

// docs/spec.md 2.2「履歴スライド機能」: 最大10件までスタックし、11件目以降は最古を破棄する。
const MAX_HISTORY_LENGTH = 10

// docs/spec.md 4章のエラーコード定義に沿った、ユーザー向けの日本語メッセージ。
// ステップ14（ADR-017）でバックエンドが構造化エラーボディのmessageを返すようになったため、
// 通常はそちらを優先表示する。この関数は「バックエンド不達・非JSONレスポンス等でmessageが
// 得られない場合のフォールバック」として残す。バックエンド提供文言と齟齬が出ないよう、
// バックエンドのapp/errors._ERROR_CATALOGと同じ文言に揃えている。定義外のステータスは想定外エラー扱い。
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
  // ステップ16: JSON入力エディタの生テキスト。htmlContentと同様、fetchRender成功時は
  // レスポンスのjsonで上書きされ、次の編集の起点になる（docs/spec.md 2.2「リアルタイム双方向プレビュー」）。
  // パース・妥当性検証はバックエンド（400 VALIDATION_ERROR）に委ね、フロントは生テキストのまま送信する。
  jsonContent: string
  // ステップ16: プロンプト入力エディタの内容。レスポンスに対応するフィールドが無いため、
  // htmlContent/jsonContentと異なりfetchRender成功時にも上書きされず、ユーザーの入力のまま保持する。
  promptContent: string
  pdfFile: File | null
  pdfFileName: string | null
  // ステップ8: 縦幅・横幅サイズ入力（docs/spec.md 2.1「コントロール」）。
  // nullは「未入力」を表し、fetchRenderではAPIへ送らない（Optional[float] = Form(None)と対応）。
  // ステップ17: サイズ選択UIの初期値をA4よこに統一するため、ストア生成時点からnullではなく
  // A4よこの寸法を初期値として持たせる。
  widthMm: number | null
  heightMm: number | null
  history: HistoryEntry[]
  isLoading: boolean
  error: string | null
  // ステップ8: docs/spec.md 2.2「インテリジェントメッセージ表示」の成功メッセージ側。
  // エラーと同様にトースト表示用の文言のみを保持し、表示形式（Toastコンポーネント）とは分離する。
  successMessage: string | null
  setHtmlContent: (html: string) => void
  setJsonContent: (json: string) => void
  setPromptContent: (prompt: string) => void
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
  jsonContent: '',
  promptContent: '',
  pdfFile: null,
  pdfFileName: null,
  // ステップ17: SIZE_PRESETS.A4（たて）を初期値にする。applySizePreset('A4', 'tate')と
  // 同じ変換（幅=yoko側の210、高さ=tate側の297）をリテラルで書くと二重管理になるため、
  // SIZE_PRESETSを直接参照して定義する。
  widthMm: SIZE_PRESETS.A4.yoko,
  heightMm: SIZE_PRESETS.A4.tate,
  history: [],
  isLoading: false,
  error: null,
  successMessage: null,
  setHtmlContent: (html) => set({ htmlContent: html }),
  setJsonContent: (json) => set({ jsonContent: json }),
  setPromptContent: (prompt) => set({ promptContent: prompt }),
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
      // 現時点のエディタ内容（htmlContent/jsonContent/promptContent）とPDF（pdfFile、あれば）、
      // サイズ指定（widthMm/heightMm、あれば）をリクエストとして送り、
      // レスポンスでストアの表示内容を丸ごと置き換える（docs/spec.md 3.1）。
      // ADR-019によりcssは送らない（既存CSSはhtmlの<style>に埋め込まれている前提のため）。
      const { htmlContent, jsonContent, promptContent, pdfFile, widthMm, heightMm } = get()
      const result = await renderSheet({
        html: htmlContent,
        json: jsonContent,
        prompt: promptContent,
        pdf: pdfFile ?? undefined,
        width_mm: widthMm ?? undefined,
        height_mm: heightMm ?? undefined,
      })
      // レスポンスのjsonはオブジェクトのため、JSON入力エディタへそのまま戻せるよう
      // 整形済みテキストへ変換する（htmlContentと同様、次の編集の起点にする）。
      const newJsonContent = JSON.stringify(result.json ?? {}, null, 2)
      // 描画時点のサイズも一緒にスナップショットしておく（後からwidthMmを変えても履歴は当時の値を保持）。
      const newEntry: HistoryEntry = {
        html: result.html,
        css: result.css,
        json: newJsonContent,
        widthMm,
        heightMm,
      }
      set((state) => ({
        htmlContent: result.html,
        cssContent: result.css,
        jsonContent: newJsonContent,
        isLoading: false,
        successMessage: '描画が完了しました',
        // 新しい履歴を先頭に積み、MAX_HISTORY_LENGTHを超えた分（最も古い履歴）は切り捨てる
        // （docs/spec.md 2.2「履歴スライド機能」: 11件目以降は最も古い履歴を破棄）。
        history: [newEntry, ...state.history].slice(0, MAX_HISTORY_LENGTH),
      }))
    } catch (err) {
      // ステップ14（ADR-017）: バックエンドが返す構造化エラーの安全文言（backendMessage）を
      // 最優先で表示する。バックエンド不達・非JS（backendMessageがnull）の場合のみ、
      // ステータス別の既定文言へフォールバックする。RenderApiError以外（ネットワーク断や
      // JSON解釈失敗など）は想定外エラー扱い（messageForStatusのdefault）にする。
      const message =
        err instanceof RenderApiError
          ? (err.backendMessage ?? messageForStatus(err.status))
          : messageForStatus(0)
      set({
        error: message,
        successMessage: null,
        isLoading: false,
      })
    }
  },
}))
