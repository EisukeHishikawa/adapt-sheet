import type { components } from '@/types/api'

// バックエンドのopenapi.jsonから自動生成した型（frontend/src/types/api.ts）を
// そのまま公開レスポンス型として再エクスポートする。フロント側でキー名を手書きしないため
// （CLAUDE.md「型安全」の規約）、この型定義を経由せずに/api/renderのレスポンスを扱わないこと。
export type RenderResponse = components['schemas']['RenderResponse']

// docs/spec.md 3.1の契約に沿ったフィールドのみを手書きする（CLAUDE.mdの型安全規約）。
// ADR-019により、cssは独立したリクエストフィールドを持たない（既存CSSはhtml側の<style>に
// 埋め込まれている前提のため）ので、ここにも追加しない。width_mm/height_mmはステップ8の
// 定型サイズ自動入力機能で、json/promptはステップ16のJSON/プロンプト入力エディタで使う。
export type RenderRequestFields = {
  html?: string
  json?: string
  prompt?: string
  pdf?: File
  width_mm?: number
  height_mm?: number
}

// ステップ14（ADR-017）: バックエンドが返す構造化エラーボディ
// `{"error": {"code", "message", "request_id"}}` から取り出した情報。
// バックエンドを一次ソースとしてユーザー向けメッセージを画面表示するために保持する。
export type RenderErrorInfo = {
  // 機械可読なエラー識別子（VALIDATION_ERROR等）。将来のフロント分岐用に保持する。
  code: string | null
  // バックエンドが返すユーザー向けの安全な日本語文言。画面表示に用いる。
  backendMessage: string | null
  // ログと突き合わせるための相関ID（X-Request-IDと同値）。問い合わせ時の参照用に保持する。
  requestId: string | null
}

// docs/spec.md 4章のエラーコード定義（400/413/422/429/502/500）をストア側で
// 判定できるよう、HTTPステータスコードを保持したまま呼び出し側に伝播させるための専用エラー型。
// 通常のErrorだとステータスコードがmessage文字列に埋め込まれ、呼び出し側での判定が
// 文字列パースに頼ってしまうため、専用クラスとして分離する。
// ステップ14（ADR-017）で、バックエンド提供のcode/message/request_idも合わせて運ぶよう拡張した。
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

// 構造化エラーボディ（docs/spec.md 4.1）を安全に取り出す。
// バックエンド不達・非JSON・旧形式など、エンベロープでない場合はnullを返し、
// 呼び出し側がステータス別の既定文言へフォールバックできるようにする。
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
    // ボディが空/非JSONの場合はフォールバック（undefined）にする。
    return undefined
  }
  // ボディにrequest_idが無くてもヘッダーから拾えれば相関IDを補完する。
  if (info && !info.requestId) {
    info.requestId = response.headers.get('X-Request-ID')
  }
  return info
}

// docs/spec.md 3.1が`multipart/form-data`を要求しているため、pdfファイルも
// 同じ関数で扱えるようFormDataを使う（JSON.stringifyのapplication/jsonにはしない）。
export async function renderSheet(fields: RenderRequestFields): Promise<RenderResponse> {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    formData.append(key, typeof value === 'number' ? String(value) : value)
  }

  const response = await fetch('/api/render', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    // バックエンドの構造化エラーボディ（ADR-017）を取り出し、
    // ユーザー向けメッセージ・相関IDを保持したままストア側へ伝播させる。
    const info = await parseErrorBody(response)
    throw new RenderApiError(response.status, info)
  }

  try {
    return (await response.json()) as RenderResponse
  } catch {
    // 200応答でも本文が空/不正なJSONの場合にSyntaxErrorをそのまま伝播させず、
    // 呼び出し側（sheetStore.fetchRender）に意味の伝わるメッセージを渡す。
    throw new Error('/api/render のレスポンスがJSONとして解釈できませんでした')
  }
}
