import { create } from 'zustand'
import { RenderApiError, renderSheet, saveEditHistory } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

// 左（入力・プレビュー）と右（コード入力）の2カラムを、propsのバケツリレーなしに連動させるための
// グローバルストア（ADR-008）。
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

// モデル選択（EngineSelect）の7エンジン（ADR-015）。gemini_free/gemini/claude/openaiは
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

// renderは描画結果、editは描画を経ずに保存した編集中スナップショット。両者を同じ履歴列へ
// 時系列で混在させ、HistorySlider側で見た目を分ける。
export type HistoryKind = 'render' | 'edit'

// seqは履歴ごとの通し番号。古い履歴が消えても振り直さず単調増加させる（ユーザー要望）。
export type HistoryItem = HistoryEntry & { seq: number; kind: HistoryKind }

// docs/spec.md 2.2「履歴スライド機能」の上限。描画結果と編集中スナップショットで枠を共有し、
// 超過分はseqが最小＝最古のものから削除する。
const MAX_HISTORY_LENGTH = 10

// 編集を止めてからスナップショットを積むまでの待ち時間。1打鍵ごとに積むと履歴が即座に
// 埋まるため、入力が落ち着いた区切りだけを1件として残す。
export const EDIT_SNAPSHOT_DELAY_MS = 1500

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

// バックエンドが構造化エラーの安全文言を返す（ADR-012）ため通常はそちらを表示する。これは
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
  // 描画ボタンの隣（EngineSelect）で選択する生成エンジン（ADR-015）。既定は無料枠のGemini。
  engine: RenderEngineId
  history: HistoryItem[]
  historySeq: number
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
  // 保留中の待ち時間を待たず、その時点の編集内容を履歴へ確定する。
  commitEditSnapshot: () => void
  dismissError: () => void
  dismissSuccessMessage: () => void
  fetchRender: () => Promise<void>
}

// 入力のたびにタイマーを張り直すことで、連続打鍵を1件のスナップショットへまとめる。
// ストア外の可変状態にするのは、タイマーIDが購読者へ配る状態ではないため。
let editSnapshotTimer: ReturnType<typeof setTimeout> | null = null

function cancelScheduledEditSnapshot(): void {
  if (editSnapshotTimer !== null) {
    clearTimeout(editSnapshotTimer)
    editSnapshotTimer = null
  }
}

function scheduleEditSnapshot(get: () => SheetState): void {
  cancelScheduledEditSnapshot()
  editSnapshotTimer = setTimeout(() => {
    editSnapshotTimer = null
    get().commitEditSnapshot()
  }, EDIT_SNAPSHOT_DELAY_MS)
}

// ログイン済みの場合のみ、編集中スナップショットをサーバーの履歴へも残す（kind="edit"として
// 保存される）。編集操作を妨げないよう、結果は待たず失敗も画面へ出さない。
function saveEditSnapshotToServer(entry: HistoryEntry, engine: RenderEngineId): void {
  const accessToken = useAuthStore.getState().session?.access_token
  if (!accessToken) return

  let jsonData: Record<string, unknown> = {}
  try {
    const parsed: unknown = entry.json === '' ? {} : JSON.parse(entry.json)
    // 編集途中のJSONは配列や不正な値になり得るが、その場合もHTML側は残したいので空で送る。
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      jsonData = parsed as Record<string, unknown>
    }
  } catch {
    jsonData = {}
  }

  void saveEditHistory(
    {
      engine,
      html: entry.html,
      css: entry.css,
      json: jsonData,
      width_mm: entry.widthMm,
      height_mm: entry.heightMm,
    },
    accessToken,
  ).catch(() => undefined)
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
  isLoading: false,
  error: null,
  successMessage: null,
  setHtmlContent: (html) => {
    set({ htmlContent: html })
    scheduleEditSnapshot(get)
  },
  setJsonContent: (json) => {
    set({ jsonContent: json })
    scheduleEditSnapshot(get)
  },
  setPromptContent: (prompt) => set({ promptContent: prompt }),
  setPdfFile: (file) => set({ pdfFile: file, pdfFileName: file?.name ?? null }),
  setWidthMm: (widthMm) => set({ widthMm }),
  setHeightMm: (heightMm) => set({ heightMm }),
  setEngine: (engine) => set({ engine }),
  applySizePreset: (size, orientation) => set(dimensionsFor(size, orientation)),
  // 復元は破壊的にしない。待ち時間の途中で履歴を選んでも編集内容を失わないよう、上書きの前に
  // 保留中のスナップショットを確定させる。
  restoreFromHistory: (index) => {
    // 確定より先に対象を取り出す。commitEditSnapshotが先頭へ1件積むと位置がずれるため。
    const entry = get().history[index]
    if (!entry) return

    get().commitEditSnapshot()
    set(toEditorState(entry))
  },
  commitEditSnapshot: () => {
    cancelScheduledEditSnapshot()

    const state = get()
    const current = snapshotEntry(state)
    // 空の入力と、履歴に同じ内容が既にあるもの（描画直後・履歴復元直後）は積まない。
    if (current.html === '' && current.css === '' && current.json === '') return
    if (state.history.some((item) => entriesEqual(item, current))) return

    const nextSeq = state.historySeq + 1
    set({
      historySeq: nextSeq,
      history: [{ ...current, seq: nextSeq, kind: 'edit' as const }, ...state.history].slice(
        0,
        MAX_HISTORY_LENGTH,
      ),
    })
    saveEditSnapshotToServer(current, state.engine)
  },
  dismissError: () => set({ error: null }),
  dismissSuccessMessage: () => set({ successMessage: null }),
  fetchRender: async () => {
    // 描画結果でエディタを上書きする前に、待ち時間の途中だった編集内容を履歴へ残す。
    get().commitEditSnapshot()
    // ここで前回のメッセージを消さないと、再試行の通信中も前回のエラー文言が残り誤解を与える。
    set({ isLoading: true, error: null, successMessage: null })

    try {
      // cssは送らない（既存CSSはhtmlの<style>に埋め込まれている前提。ADR-014）。
      // jsonContentも送らない（業務データはAIへの入力として不要で、レスポンス側でのみ返る）。
      // htmlContentも送らない（ADR-015：生成AIへの入力はPDFファイルの直接添付のみで、
      // HTML・Docling抽出テキストは使わない）。
      const { promptContent, pdfFile, widthMm, heightMm, engine } = get()
      // gemini/claude/openai（標準プラン）はログイン済みユーザーのみ利用可能（DEVELOPMENT.md
      // ステップ27）。未ログイン時はaccess_tokenがundefinedのままrenderSheetへ渡り、
      // ゲート対象engineはバックエンドが403を返す。
      const accessToken = useAuthStore.getState().session?.access_token
      const result = await renderSheet(
        {
          prompt: promptContent,
          pdf: pdfFile ?? undefined,
          width_mm: widthMm ?? undefined,
          height_mm: heightMm ?? undefined,
          engine,
        },
        accessToken,
      )

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
          history: [{ ...newEntry, seq: nextSeq, kind: 'render' as const }, ...state.history].slice(
            0,
            MAX_HISTORY_LENGTH,
          ),
        }
      })
    } catch (err) {
      // バックエンド提供の安全文言（ADR-012）を最優先し、得られない場合のみ既定文言へ落とす。
      const message =
        err instanceof RenderApiError
          ? (err.backendMessage ?? messageForStatus(err.status))
          : messageForStatus(0)
      set({ error: message, successMessage: null, isLoading: false })
    }
  },
}))
