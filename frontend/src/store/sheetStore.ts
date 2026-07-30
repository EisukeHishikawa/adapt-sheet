import { create } from 'zustand'
import {
  RenderApiError,
  getGeminiFreeUsage,
  getHistory,
  getRenderJobStatus,
  renderSheet,
  requestUploadUrl,
  saveEditHistory,
  startRenderJob,
  updateEditHistory,
  uploadPdfToPresignedUrl,
} from '@/lib/api'
import type { HistoryItemResponse, RenderJobStatusResponse } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

// 左（入力・プレビュー）と右（コード入力）の2カラムを、propsのバケツリレーなしに連動させるための
// グローバルストア。
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

// モデル選択（EngineSelect）の8エンジン。gemini_free/gemini/claude/openai/hybridは
// 生成AI（LLMがHTML/CSS/JSONを作る）、docling/pdf2htmlex/pymupdfはAIを介さない変換エンジン
// （変換結果をそのまま描画結果にする）。hybridはPyMuPDF・Docling・Gemini（VLM）を組み合わせる
// 生成AIで、PDF添付必須。アイコン・説明文などの表示情報はEngineSelect.tsx側が持つ。
export type RenderEngineId =
  | 'gemini_free'
  | 'gemini'
  | 'claude'
  | 'openai'
  | 'hybrid'
  | 'docling'
  | 'pdf2htmlex'
  | 'pymupdf'

// 生成AIエンジン（backendのGATED_ENGINES + gemini_free/hybrid）。Gemini API自体が
// 20〜60秒以上かかることがあり、API Gatewayの29秒固定タイムアウトを受けないよう、
// この集合のengineのみ非同期ジョブ（POST /api/render/jobs→ポーリング）で描画する。
// docling/pdf2htmlex/pymupdfは常に高速なため対象外（既存のrenderSheetのまま）。
const AI_ENGINES: ReadonlySet<RenderEngineId> = new Set([
  'gemini_free',
  'gemini',
  'claude',
  'openai',
  'hybrid',
])

// hybridはgemini_freeと同じ無料枠モデルを使うため（backend/app/services/gemini_usage.py
// GEMINI_FREE_QUOTA_ENGINES参照）、同じ共有カウンタの表示対象にする。
const GEMINI_FREE_QUOTA_ENGINES: ReadonlySet<RenderEngineId> = new Set(['gemini_free', 'hybrid'])

// ポーリング間隔。warmupStoreと同じ発想でテスト側はvi.useFakeTimersでスキップする。
const RENDER_JOB_POLL_INTERVAL_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
// serverIdはログイン時にサーバーへ保存した行のID。同じ編集中スナップショットを上書きするために持つ。
export type HistoryItem = HistoryEntry & { seq: number; kind: HistoryKind; serverId?: string }

// docs/spec.md 2.2「履歴スライド機能」の上限。描画結果と編集中スナップショットで枠を共有し、
// 超過分はseqが最小＝最古のものから削除する。
export const MAX_HISTORY_LENGTH = 10

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

// GET /api/historyのレスポンス行をローカルのHistoryEntryへ変換する。jsonはJSON入力エディタへ
// 戻せる整形済みテキストにする（fetchRenderの結果反映と同じ扱い）。
function fromHistoryResponse(row: HistoryItemResponse): HistoryEntry {
  return {
    html: row.html,
    css: row.css,
    json: JSON.stringify(row.json ?? {}, null, 2),
    widthMm: row.width_mm ?? null,
    heightMm: row.height_mm ?? null,
  }
}

// バックエンドが構造化エラーの安全文言を返すため通常はそちらを表示する。これは
// バックエンド不達・非JSONレスポンスでその文言が得られない場合のフォールバックで、
// バックエンド（app/errors._ERROR_CATALOG）と同じ文言に揃える（docs/spec.md 4章）。
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'リクエスト内容に誤りがあります。入力値をご確認ください。'
    case 428:
      return 'このエンジンを使うにはPDFファイルの添付が必要です。ファイルを選択してください。'
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
    case 503:
      return '生成AIサービスが混雑しています。しばらく時間をおいて再度お試しください。'
    case 501:
      return '現在、利用停止中です。'
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
  // 描画ボタンの隣（EngineSelect）で選択する生成エンジン。既定は無料枠のGemini。
  engine: RenderEngineId
  history: HistoryItem[]
  historySeq: number
  // 現在編集中のスナップショットのseq。編集を続けても履歴を増やさず、この1件を上書きする。
  // 描画直後や描画履歴を復元した直後は、次の編集で新しい1件を作るためnullにする。
  activeEditSeq: number | null
  isLoading: boolean
  error: string | null
  successMessage: string | null
  setHtmlContent: (html: string) => void
  setCssContent: (css: string) => void
  setJsonContent: (json: string) => void
  setPromptContent: (prompt: string) => void
  setPdfFile: (file: File | null) => void
  setWidthMm: (widthMm: number | null) => void
  setHeightMm: (heightMm: number | null) => void
  setEngine: (engine: RenderEngineId) => void
  applySizePreset: (size: SizePresetName, orientation: Orientation) => void
  restoreFromHistory: (index: number) => void
  // ログイン確定時・リロード後などhistoryが空のタイミングで、DB保存済みの履歴を取り直して
  // 最大MAX_HISTORY_LENGTH件をhistoryへ反映する（セッションが切れてメモリ上のhistoryが
  // 失われても、再ログイン後に描画・編集の履歴を表示し直すため）。
  hydrateHistoryFromServer: () => Promise<void>
  // HistoryArchive（MAX_HISTORY_LENGTH件の枠外にある過去データ一覧）から選んだ内容をエディタへ復元する。
  restoreFromServerEntry: (row: HistoryItemResponse) => void
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

// 保存要求を直列化する。保存の往復より先に次の編集が確定すると、まだIDを受け取っていない
// スナップショットを二重に新規作成してしまうため。
let editSaveChain: Promise<void> = Promise.resolve()

function toJsonData(rawJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = rawJson === '' ? {} : JSON.parse(rawJson)
    // 編集途中のJSONは配列や不正な値になり得るが、その場合もHTML側は残したいので空で送る。
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return {}
  }
  return {}
}

// ログイン済みの場合のみ、編集中スナップショットをサーバーの履歴へも残す（kind="edit"として
// 保存される）。編集操作を妨げないよう、結果は待たず失敗も画面へ出さない。
function syncEditSnapshotToServer(seq: number, entry: HistoryEntry, engine: RenderEngineId): void {
  const accessToken = useAuthStore.getState().session?.access_token
  if (!accessToken) return

  const payload = {
    engine,
    html: entry.html,
    css: entry.css,
    json: toJsonData(entry.json),
    width_mm: entry.widthMm,
    height_mm: entry.heightMm,
  }

  editSaveChain = editSaveChain
    .then(async () => {
      // 直前の保存でIDが確定していることがあるため、送信の直前にストアから引き直す。
      const serverId = useSheetStore.getState().history.find((item) => item.seq === seq)?.serverId
      if (serverId) {
        await updateEditHistory(serverId, payload, accessToken)
        return
      }

      const saved = await saveEditHistory(payload, accessToken)
      useSheetStore.setState((state) => ({
        history: state.history.map((item) =>
          item.seq === seq ? { ...item, serverId: saved.id } : item,
        ),
      }))
    })
    .catch(() => undefined)
}

type RenderResultLike = { html: string; css: string; json?: Record<string, unknown> | null }

// job_store.write_status(status="error")のmessageを画面のerrorへそのまま出す（backendの
// _generate_ai_result由来の安全文言のため、messageForStatusのようなステータス別変換は不要）。
class RenderJobFailedError extends Error {}

// 変換エンジン（docling/pdf2htmlex/pymupdf）向けの既存の同期経路。挙動は変更しない。
async function runRenderSync(): Promise<RenderResultLike> {
  const { promptContent, pdfFile, widthMm, heightMm, engine, htmlContent, jsonContent } =
    useSheetStore.getState()
  const accessToken = useAuthStore.getState().session?.access_token
  return renderSheet(
    {
      prompt: promptContent,
      pdf: pdfFile ?? undefined,
      current_html: pdfFile ? undefined : htmlContent || undefined,
      current_json: pdfFile ? undefined : jsonContent || undefined,
      width_mm: widthMm ?? undefined,
      height_mm: heightMm ?? undefined,
      engine,
    },
    accessToken,
  )
}

// 生成AIエンジン向けの非同期経路。PDFがある場合のみ先にS3へ直接アップロードし、
// そのjob_idを描画ジョブでも使い回す。ジョブ起動後はstatusがpendingでなくなるまで
// 一定間隔でポーリングする（API Gatewayの29秒制約を受けないため、Gemini自体が
// 20〜60秒以上かかっても待ちきれる）。
async function runRenderJob(): Promise<RenderResultLike> {
  const { promptContent, pdfFile, widthMm, heightMm, engine, htmlContent, jsonContent } =
    useSheetStore.getState()
  const accessToken = useAuthStore.getState().session?.access_token

  let jobId: string | undefined
  if (pdfFile) {
    const uploadTarget = await requestUploadUrl()
    await uploadPdfToPresignedUrl(uploadTarget.upload_url, pdfFile)
    jobId = uploadTarget.job_id
  }

  const job = await startRenderJob(
    {
      prompt: promptContent,
      width_mm: widthMm ?? undefined,
      height_mm: heightMm ?? undefined,
      engine,
      current_html: pdfFile ? undefined : htmlContent || undefined,
      current_json: pdfFile ? undefined : jsonContent || undefined,
      job_id: jobId,
      has_pdf: Boolean(pdfFile),
    },
    accessToken,
  )

  let status: RenderJobStatusResponse = await getRenderJobStatus(job.job_id)
  while (status.status === 'pending') {
    await sleep(RENDER_JOB_POLL_INTERVAL_MS)
    status = await getRenderJobStatus(job.job_id)
  }

  if (status.status !== 'done') {
    throw new RenderJobFailedError(status.message ?? messageForStatus(0))
  }

  return { html: status.html ?? '', css: status.css ?? '', json: status.json }
}

// renderSheet/runRenderJobいずれの結果も、この関数を通してエディタ・履歴へ同じ形で反映する。
function applySuccessfulRender(
  result: RenderResultLike,
  widthMm: number | null,
  heightMm: number | null,
): void {
  const newEntry: HistoryEntry = {
    html: result.html,
    css: result.css,
    // レスポンスのjsonはオブジェクトのため、JSON入力エディタへ戻せる整形済みテキストにする。
    json: JSON.stringify(result.json ?? {}, null, 2),
    widthMm,
    heightMm,
  }

  useSheetStore.setState((state) => {
    const nextSeq = state.historySeq + 1
    return {
      ...toEditorState(newEntry),
      isLoading: false,
      successMessage: '描画が完了しました',
      historySeq: nextSeq,
      // 描画結果が新しい基準になるため、次の編集は新しい編集中スナップショットとして積む。
      activeEditSeq: null,
      // 添付したPDFは1回の描画にのみ使う。応答が返った時点で解除し、次回以降は
      // 現在のHTML/JSON（今回の描画結果）を基準に生成させる。
      pdfFile: null,
      pdfFileName: null,
      history: [{ ...newEntry, seq: nextSeq, kind: 'render' as const }, ...state.history].slice(
        0,
        MAX_HISTORY_LENGTH,
      ),
    }
  })
}

export const useSheetStore = create<SheetState>((set, get) => ({
  htmlContent: '',
  cssContent: '',
  jsonContent: '',
  promptContent: '',
  pdfFile: null,
  pdfFileName: null,
  ...dimensionsFor('A4', 'tate'),
  engine: 'hybrid',
  history: [],
  historySeq: 0,
  activeEditSeq: null,
  isLoading: false,
  error: null,
  successMessage: null,
  setHtmlContent: (html) => {
    set({ htmlContent: html })
    scheduleEditSnapshot(get)
  },
  setCssContent: (css) => {
    set({ cssContent: css })
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
    set({
      ...toEditorState(entry),
      // 編集中を選んだ場合はその1件の続きとして編集する。描画結果を選んだ場合は次の編集で
      // 新しい編集中スナップショットを作る。
      activeEditSeq: entry.kind === 'edit' ? entry.seq : null,
    })
  },
  hydrateHistoryFromServer: async () => {
    const accessToken = useAuthStore.getState().session?.access_token
    if (!accessToken) return

    try {
      const rows = await getHistory(accessToken)
      if (rows.length === 0) return

      // rowsは新しい順（backend/app/services/history.list_history）。表示枠は
      // MAX_HISTORY_LENGTHまでとし、それより古い行はHistoryArchive側でのみ扱う。
      const visible = rows.slice(0, MAX_HISTORY_LENGTH)
      const total = visible.length
      set({
        history: visible.map((row, index) => ({
          ...fromHistoryResponse(row),
          // 新しいものほどseqが大きい既存の並びに合わせる（先頭=最新=最大seq）。
          seq: total - index,
          kind: row.kind === 'edit' ? ('edit' as const) : ('render' as const),
          serverId: row.id,
        })),
        historySeq: total,
      })
    } catch {
      // 履歴の復元は補助機能のため、失敗しても画面の初期表示は止めない。
    }
  },
  restoreFromServerEntry: (row) => {
    get().commitEditSnapshot()
    set({
      ...toEditorState(fromHistoryResponse(row)),
      // 表示中のhistory配列には無い行のため、続けて編集しても新しい編集中スナップショットとして積む。
      activeEditSeq: null,
    })
  },
  commitEditSnapshot: () => {
    cancelScheduledEditSnapshot()

    const state = get()
    const current = snapshotEntry(state)
    // 空の入力と、履歴に同じ内容が既にあるもの（描画直後・履歴復元直後）は積まない。
    if (current.html === '' && current.css === '' && current.json === '') return
    if (state.history.some((item) => entriesEqual(item, current))) return

    // 編集中スナップショットを編集し続けている間は、履歴を増やさず同じ1件を上書きする。
    const activeIndex = state.history.findIndex((item) => item.seq === state.activeEditSeq)
    if (activeIndex >= 0) {
      const updated = { ...state.history[activeIndex], ...current }
      const history = [...state.history]
      history[activeIndex] = updated
      set({ history })
      syncEditSnapshotToServer(updated.seq, current, state.engine)
      return
    }

    const nextSeq = state.historySeq + 1
    set({
      historySeq: nextSeq,
      activeEditSeq: nextSeq,
      history: [{ ...current, seq: nextSeq, kind: 'edit' as const }, ...state.history].slice(
        0,
        MAX_HISTORY_LENGTH,
      ),
    })
    syncEditSnapshotToServer(nextSeq, current, state.engine)
  },
  dismissError: () => set({ error: null }),
  dismissSuccessMessage: () => set({ successMessage: null }),
  fetchRender: async () => {
    // 描画結果でエディタを上書きする前に、待ち時間の途中だった編集内容を履歴へ残す。
    get().commitEditSnapshot()
    // ここで前回のメッセージを消さないと、再試行の通信中も前回のエラー文言が残り誤解を与える。
    set({ isLoading: true, error: null, successMessage: null })

    try {
      const { widthMm, heightMm, engine } = get()
      const result = AI_ENGINES.has(engine) ? await runRenderJob() : await runRenderSync()

      applySuccessfulRender(result, widthMm, heightMm)

      // Gemini無料枠は全ユーザー共有・日次リセットの共有カウンタのため、描画ボタンを押して
      // 成功した都度、最新の利用回数を取得して成功メッセージへ付加する。取得に失敗しても
      // 描画自体は成功しているため、既定の成功メッセージのまま表示する。
      if (GEMINI_FREE_QUOTA_ENGINES.has(engine)) {
        try {
          const usage = await getGeminiFreeUsage()
          set({ successMessage: `描画が完了しました（Gemini無料枠 本日${usage.count}/${usage.limit}回）` })
        } catch {
          // 既定の成功メッセージのままにする（何もしない）。
        }
      }
    } catch (err) {
      // バックエンド提供の安全文言を最優先し、得られない場合のみ既定文言へ落とす。
      const message =
        err instanceof RenderApiError
          ? (err.backendMessage ?? messageForStatus(err.status))
          : err instanceof RenderJobFailedError
            ? err.message
            : messageForStatus(0)
      set({ error: message, successMessage: null, isLoading: false })
    }
  },
}))
