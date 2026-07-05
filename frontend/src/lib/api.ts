import type { components } from '@/types/api'

// バックエンドのopenapi.jsonから自動生成した型（frontend/src/types/api.ts）を
// そのまま公開レスポンス型として再エクスポートする。フロント側でキー名を手書きしないため
// （CLAUDE.md「型安全」の規約）、この型定義を経由せずに/api/renderのレスポンスを扱わないこと。
export type RenderResponse = components['schemas']['RenderResponse']

// docs/spec.md 3.1のリクエストフィールド。ステップ5時点ではhtmlのみエディタから渡されるが、
// フェーズ3以降でpdf/css/json/prompt/width_mm/height_mmも同じ関数から送れるよう先出しで定義する。
export type RenderRequestFields = {
  html?: string
  css?: string
  json?: string
  prompt?: string
  width_mm?: number
  height_mm?: number
  pdf?: File
}

// docs/spec.md 3.1が`multipart/form-data`を要求しているため、pdfファイル送信も
// 将来同じ関数で扱えるようFormDataを使う（JSON.stringifyのapplication/jsonにはしない）。
export async function renderSheet(fields: RenderRequestFields): Promise<RenderResponse> {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    // File/Blobはそのまま、それ以外（string/number）はFormData.appendの型制約に合わせ文字列化する。
    formData.append(key, value instanceof File ? value : String(value))
  }

  const response = await fetch('/api/render', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    // docs/spec.md 4章のエラーコード定義に沿ってステータスコードを呼び出し側に伝える。
    throw new Error(`/api/render が失敗しました (status: ${response.status})`)
  }

  return (await response.json()) as RenderResponse
}
