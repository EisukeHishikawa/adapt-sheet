import type { components } from '@/types/api'

// バックエンドのopenapi.jsonから自動生成した型（frontend/src/types/api.ts）を
// そのまま公開レスポンス型として再エクスポートする。フロント側でキー名を手書きしないため
// （CLAUDE.md「型安全」の規約）、この型定義を経由せずに/api/renderのレスポンスを扱わないこと。
export type RenderResponse = components['schemas']['RenderResponse']

// docs/spec.md 3.1はcss/json/promptも含む契約だが、対応するエディタ（CSS/JSON/プロンプト入力）は
// まだ未実装のため、CLAUDE.mdの型安全規約に沿って「実際に使うフィールドだけ」を手書きし、
// 手書き範囲を最小に保つ。width_mm/height_mmはステップ8の定型サイズ自動入力機能で使うため追加。
// 他フィールドをエディタに追加するタイミングで、生成された型
// （frontend/src/types/api.ts の Body_render_api_render_post）に順次揃えていく。
export type RenderRequestFields = {
  html?: string
  pdf?: File
  width_mm?: number
  height_mm?: number
}

// docs/spec.md 4章のエラーコード定義（400/413/422/429/502/500）をストア側で
// 判定できるよう、HTTPステータスコードを保持したまま呼び出し側に伝播させるための専用エラー型。
// 通常のErrorだとステータスコードがmessage文字列に埋め込まれ、呼び出し側での判定が
// 文字列パースに頼ってしまうため、専用クラスとして分離する。
export class RenderApiError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`/api/render が失敗しました (status: ${status})`)
    this.name = 'RenderApiError'
    this.status = status
  }
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
    throw new RenderApiError(response.status)
  }

  try {
    return (await response.json()) as RenderResponse
  } catch {
    // 200応答でも本文が空/不正なJSONの場合にSyntaxErrorをそのまま伝播させず、
    // 呼び出し側（sheetStore.fetchRender）に意味の伝わるメッセージを渡す。
    throw new Error('/api/render のレスポンスがJSONとして解釈できませんでした')
  }
}
