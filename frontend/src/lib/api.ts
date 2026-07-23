import type { components } from '@/types/api'

// バックエンドのopenapi.jsonから自動生成した型（ADR-005）。フロント側でキー名を手書きしないため、
// /api/renderのレスポンスはこの型を経由してのみ扱う。
export type RenderResponse = components['schemas']['RenderResponse']

// 編集中スナップショットの保存リクエスト（POST /api/history/edit）。ログイン済みユーザーのみ
// 呼び出せる（未ログインはバックエンドが403）。
export type HistoryEditRequest = components['schemas']['HistoryEditRequest']
export type HistoryItemResponse = components['schemas']['HistoryItemResponse']

// docs/spec.md 3.1の契約に沿ったリクエスト項目。
// cssは持たない（既存CSSはhtml側の<style>に埋め込まれている前提。ADR-014）。
// jsonも持たない（業務データはAIへの入力として不要で、レスポンス側でのみ返る）。
// htmlも持たない（ADR-015：生成AIへの入力はPDFファイルの直接添付のみ。変換エンジンもpdfのみを見る）。
export type RenderRequestFields = {
  prompt?: string
  pdf?: File
  width_mm?: number
  height_mm?: number
  // EngineSelectで選択した生成エンジン（ADR-015）。gemini_free/gemini/claude/openai/
  // docling/pdf2htmlex/pymupdfのいずれか。
  engine?: string
}

// バックエンドの構造化エラーボディ（ADR-012）から取り出した情報。
export type RenderErrorInfo = {
  code: string | null
  // ユーザーへ表示する安全な日本語文言。
  backendMessage: string | null
  // サーバーログと突き合わせるための相関ID（X-Request-IDと同値）。
  requestId: string | null
}

// ステータスコードをmessage文字列に埋め込むと呼び出し側の判定が文字列パースに頼ることになるため、
// docs/spec.md 4章のエラーコード判定用に専用のエラー型として分離する。
export class RenderApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly backendMessage: string | null
  readonly requestId: string | null

  constructor(status: number, info?: Partial<RenderErrorInfo>) {
    super(`/api/render が失敗しました (status: ${status})`)
    this.name = 'RenderApiError'
    this.status = status
    this.code = info?.code ?? null
    this.backendMessage = info?.backendMessage ?? null
    this.requestId = info?.requestId ?? null
  }
}

// バックエンド不達・非JSONなどエンベロープでない応答ではundefinedを返し、呼び出し側が
// ステータス別の既定文言へフォールバックできるようにする。
async function parseErrorBody(response: Response): Promise<RenderErrorInfo | undefined> {
  let info: RenderErrorInfo | undefined
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body) {
      const error = (body as { error: Record<string, unknown> }).error
      info = {
        code: typeof error.code === 'string' ? error.code : null,
        backendMessage: typeof error.message === 'string' ? error.message : null,
        requestId: typeof error.request_id === 'string' ? error.request_id : null,
      }
    }
  } catch {
    return undefined
  }
  // ボディにrequest_idが無くてもヘッダーから拾えれば相関IDを補完する。
  if (info && !info.requestId) {
    info.requestId = response.headers.get('X-Request-ID')
  }
  return info
}

// docs/spec.md 3.1が`multipart/form-data`を要求するため、pdfも同じ関数で扱えるようFormDataを使う。
// accessTokenはauthStoreのsession.access_token（DEVELOPMENT.md ステップ27）。未ログイン時は
// undefinedのままAuthorizationヘッダーを付けず、ゲート対象engineはバックエンドが403を返す。
export async function renderSheet(
  fields: RenderRequestFields,
  accessToken?: string,
): Promise<RenderResponse> {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    formData.append(key, typeof value === 'number' ? String(value) : value)
  }

  const response = await fetch('/api/render', {
    method: 'POST',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: formData,
  })

  if (!response.ok) {
    throw new RenderApiError(response.status, await parseErrorBody(response))
  }

  try {
    return (await response.json()) as RenderResponse
  } catch {
    // 200応答でも本文が空/不正な場合に、SyntaxErrorをそのまま伝播させず意味の伝わる文言にする。
    throw new Error('/api/render のレスポンスがJSONとして解釈できませんでした')
  }
}

// 編集中スナップショットをサーバーの履歴へ保存する。描画と違い画面の主目的ではないため、
// 呼び出し側は結果を待たず、失敗も画面へ出さない（編集操作を妨げない）。
// 返り値のidは、以降の更新（updateEditHistory）で同じ行を指すために使う。
export async function saveEditHistory(
  fields: HistoryEditRequest,
  accessToken: string,
): Promise<HistoryItemResponse> {
  return requestEditHistory('/api/history/edit', 'POST', fields, accessToken)
}

// 既存の編集中スナップショットを上書きする。編集を続けても履歴を増やさないため（ADR-025）。
export async function updateEditHistory(
  entryId: string,
  fields: HistoryEditRequest,
  accessToken: string,
): Promise<HistoryItemResponse> {
  return requestEditHistory(
    `/api/history/edit/${encodeURIComponent(entryId)}`,
    'PUT',
    fields,
    accessToken,
  )
}

// GET /api/history。ログイン済みユーザーがDBへ保存した生成履歴・編集中スナップショットの一覧
// （新しい順、最大50件。backend/app/services/history.MAX_HISTORY_ITEMS）を取得する。
// セッションが切れて（リロード等で）sheetStoreのhistoryがメモリ上から失われた後の
// 再表示・過去データ閲覧（HistoryArchive）の両方から呼ばれる。
export async function getHistory(accessToken: string): Promise<HistoryItemResponse[]> {
  const response = await fetch('/api/history', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new RenderApiError(response.status, await parseErrorBody(response))
  }

  return (await response.json()) as HistoryItemResponse[]
}

async function requestEditHistory(
  path: string,
  method: 'POST' | 'PUT',
  fields: HistoryEditRequest,
  accessToken: string,
): Promise<HistoryItemResponse> {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(fields),
  })

  if (!response.ok) {
    throw new RenderApiError(response.status, await parseErrorBody(response))
  }

  return (await response.json()) as HistoryItemResponse
}
