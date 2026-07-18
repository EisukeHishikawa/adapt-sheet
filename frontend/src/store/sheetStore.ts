import { create } from 'zustand'
import { RenderApiError, renderSheet } from '@/lib/api'

// 左（入力・プレビュー）と右（コード入力）の2カラムを、propsのバケツリレーなしに連動させるための
// グローバルストア（ADR-009）。
//
// 用紙寸法の表（docs/spec.md 2.2「定型サイズ自動入力」）。仕様書のカラム見出し「たて (mm)」
// 「よこ (mm)」をそのままキー名にして1対1で追えるようにする。tateは長辺、yokoは短辺。
export const SIZE_PRESETS = {
  A4: { tate: 297, yoko: 210 },
  A5: { tate: 210, yoko: 148 },
  B5: { tate: 257, yoko: 182 },
} as const

export type SizePresetName = keyof typeof SIZE_PRESETS
export type Orientation = 'tate' | 'yoko'
export type Dimensions = { widthMm: number; heightMm: number }

// モデル選択（EngineSelect）の7エンジン（ADR-016）。gemini_free/gemini/claude/openaiは
// 生成AI（LLMがHTML/CSS/JSONを作る）、docling/pdf2htmlex/pymupdfはAIを介さない変換エンジン
// （変換結果をそのまま描画結果にする）。アイコン・説明文などの表示情報はEngineSelect.tsx側が持つ。
export type RenderEngineId =
  | 'gemini_free'
  | 'gemini'
  | 'claude'
  | 'openai'
  | 'docling'
  | 'pdf2htmlex'
  | 'pymupdf'

// たて（ポートレート）は短辺が幅・長辺が高さ。よこ（ランドスケープ）は用紙を90度回すため入れ替わる。
// ストアのサイズ適用とSizeControlsの選択肢表示が同じ変換を二重に持たないよう、ここへ集約する。
export function dimensionsFor(size: SizePresetName, orientation: Orientation): Dimensions {
  const preset = SIZE_PRESETS[size]
  return orientation === 'tate'
    ? { widthMm: preset.yoko, heightMm: preset.tate }
    : { widthMm: preset.tate, heightMm: preset.yoko }
}

// 1回の描画結果のスナップショット。widthMm/heightMmを含めるのは、後からサイズを変えても履歴
// サムネイルを当時の縦横比のまま再現するため。jsonは入力エディタへそのまま戻せるよう、パース済み
// オブジェクトではなく生テキストで持つ。
export type HistoryEntry = {
  html: string
  css: string
  json: string
  widthMm: number | null
  heightMm: number | null
}

// seqは描画ごとの通し番号。古い履歴が消えても振り直さず単調増加させる（ユーザー要望）。
// draftは番号を持たない編集中スナップショットのため、seqを持たないHistoryEntryのまま扱う。
export type HistoryItem = HistoryEntry & { seq: number }

// docs/spec.md 2.2「履歴スライド機能」の上限。超過分はseqが最小＝最古のものから削除する。
const MAX_HISTORY_LENGTH = 10

type EditorState = Pick<SheetState, 'htmlContent' | 'cssContent' | 'jsonContent' | 'widthMm' | 'heightMm'>

function entriesEqual(a: HistoryEntry | null, b: HistoryEntry | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.html === b.html &&
    a.css === b.css &&
    a.json === b.json &&
    a.widthMm === b.widthMm &&
    a.heightMm === b.heightMm
  )
}

function snapshotEntry(state: EditorState): HistoryEntry {
  return {
    html: state.htmlContent,
    css: state.cssContent,
    json: state.jsonContent,
    widthMm: state.widthMm,
    heightMm: state.heightMm,
  }
}

function toEditorState(entry: HistoryEntry): EditorState {
  return {
    htmlContent: entry.html,
    cssContent: entry.css,
    jsonContent: entry.json,
    widthMm: entry.widthMm,
    heightMm: entry.heightMm,
  }
}

// バックエンドが構造化エラーの安全文言を返す（ADR-013）ため通常はそちらを表示する。これは
// バックエンド不達・非JSONレスポンスでその文言が得られない場合のフォールバックで、
// バックエンド（app/errors._ERROR_CATALOG）と同じ文言に揃える（docs/spec.md 4章）。
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'リクエスト内容に誤りがあります。入力値をご確認ください。'
    case 413:
      return 'PDFファイルのサイズが上限を超えています。'
    case 422:
      return 'PDFの解析に失敗しました。ファイルの内容をご確認ください。'
    case 403:
      return '現在、この生成AIは登録ユーザーのみご利用いただけます。アカウント機能の追加までお待ちください。'
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
  // JSON入力エディタの生テキスト。描画リクエストには送らず（AIへの入力として不要）、
  // レスポンスのjsonで上書きされる。プレビューのテンプレート置換にのみ使う。
  jsonContent: string
  // レスポンスに対応するフィールドが無いため、html/jsonと違い描画成功時にも上書きしない。
  promptContent: string
  pdfFile: File | null
  pdfFileName: string | null
  // nullは「未入力」。fetchRenderではAPIへ送らない（backendのOptional[float] = Form(None)に対応）。
  widthMm: number | null
  heightMm: number | null
  // 描画ボタンの隣（EngineSelect）で選択する生成エンジン（ADR-016）。既定は無料枠のGemini。
  engine: RenderEngineId
  history: HistoryItem[]
  historySeq: number
  // 未描画・未保存の編集内容の退避スロット。履歴を選ぶとエディタが上書きされてしまうため、
  // 復元の直前にここへ退避し、HistorySliderの「編集中」カードから戻せるようにする。
  draft: HistoryEntry | null
  isLoading: boolean
  error: string | null
  successMessage: string | null
  setHtmlContent: (html: string) => void
  setJsonContent: (json: string) => void
  setPromptContent: (prompt: string) => void
  setPdfFile: (file: File | null) => void
  setWidthMm: (widthMm: number | null) => void
  setHeightMm: (heightMm: number | null) => void
  setEngine: (engine: RenderEngineId) => void
  applySizePreset: (size: SizePresetName, orientation: Orientation) => void
  restoreFromHistory: (index: number) => void
  restoreDraft: () => void
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
  ...dimensionsFor('A4', 'tate'),
  engine: 'gemini_free',
  history: [],
  historySeq: 0,
  draft: null,
  isLoading: false,
  error: null,
  successMessage: null,
  setHtmlContent: (html) => set({ htmlContent: html }),
  setJsonContent: (json) => set({ jsonContent: json }),
  setPromptContent: (prompt) => set({ promptContent: prompt }),
  setPdfFile: (file) => set({ pdfFile: file, pdfFileName: file?.name ?? null }),
  setWidthMm: (widthMm) => set({ widthMm }),
  setHeightMm: (heightMm) => set({ heightMm }),
  setEngine: (engine) => set({ engine }),
  applySizePreset: (size, orientation) => set(dimensionsFor(size, orientation)),
  // 復元は破壊的にしない。エディタの内容がまだ履歴にもドラフトにも無い「意味のある入力」なら、
  // 上書きで失わないようdraftへ退避してから復元する。
  restoreFromHistory: (index) => {
    const state = get()
    const entry = state.history[index]
    if (!entry) return

    const current = snapshotEntry(state)
    const isMeaningful = current.html !== '' || current.json !== '' || current.css !== ''
    const alreadyPreserved =
      state.history.some((item) => entriesEqual(item, current)) || entriesEqual(state.draft, current)

    set({
      ...toEditorState(entry),
      draft: isMeaningful && !alreadyPreserved ? current : state.draft,
    })
  },
  restoreDraft: () => {
    const draft = get().draft
    if (!draft) return
    set(toEditorState(draft))
  },
  dismissError: () => set({ error: null }),
  dismissSuccessMessage: () => set({ successMessage: null }),
  fetchRender: async () => {
    // ここで前回のメッセージを消さないと、再試行の通信中も前回のエラー文言が残り誤解を与える。
    set({ isLoading: true, error: null, successMessage: null })

    try {
      // cssは送らない（既存CSSはhtmlの<style>に埋め込まれている前提。ADR-015）。
      // jsonContentも送らない（業務データはAIへの入力として不要で、レスポンス側でのみ返る）。
      // htmlContentも送らない（ADR-016：生成AIへの入力はPDFファイルの直接添付のみで、
      // HTML・Docling抽出テキストは使わない）。
      const { promptContent, pdfFile, widthMm, heightMm, engine } = get()
      const result = await renderSheet({
        prompt: promptContent,
        pdf: pdfFile ?? undefined,
        width_mm: widthMm ?? undefined,
        height_mm: heightMm ?? undefined,
        engine,
      })

      const newEntry: HistoryEntry = {
        html: result.html,
        css: result.css,
        // レスポンスのjsonはオブジェクトのため、JSON入力エディタへ戻せる整形済みテキストにする。
        json: JSON.stringify(result.json ?? {}, null, 2),
        widthMm,
        heightMm,
      }

      set((state) => {
        const nextSeq = state.historySeq + 1
        return {
          ...toEditorState(newEntry),
          isLoading: false,
          successMessage: '描画が完了しました',
          historySeq: nextSeq,
          history: [{ ...newEntry, seq: nextSeq }, ...state.history].slice(0, MAX_HISTORY_LENGTH),
          // 描画成功時点の内容が新しい基準になるため、退避していた「編集中」は破棄する。
          draft: null,
        }
      })
    } catch (err) {
      // バックエンド提供の安全文言（ADR-013）を最優先し、得られない場合のみ既定文言へ落とす。
      const message =
        err instanceof RenderApiError
          ? (err.backendMessage ?? messageForStatus(err.status))
          : messageForStatus(0)
      set({ error: message, successMessage: null, isLoading: false })
    }
  },
}))
