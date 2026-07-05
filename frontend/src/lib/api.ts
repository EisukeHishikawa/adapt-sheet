import type { components } from '@/types/api'

// バックエンドのopenapi.jsonから自動生成した型（frontend/src/types/api.ts）を
// そのまま公開レスポンス型として再エクスポートする。フロント側でキー名を手書きしないため
// （CLAUDE.md「型安全」の規約）、この型定義を経由せずに/api/renderのレスポンスを扱わないこと。
export type RenderResponse = components['schemas']['RenderResponse']

// docs/spec.md 3.1はpdf/css/json/prompt/width_mm/height_mmも含む契約だが、
// 現時点でこれらを送るのはエディタ（EditorPanel）のhtmlフィールドのみ。
// バックエンドのrender()もリクエストパラメータを持たずopenapi.jsonに
// リクエストスキーマが存在しない（型を自動生成できない）ため、CLAUDE.mdの
// 型安全規約に沿って「実際に使うフィールドだけ」を手書きし、手書き範囲を最小に保つ。
// フェーズ3でバックエンドが他フィールドを受け付けるようになったら、生成された
// リクエスト型（frontend/src/types/api.ts）に置き換える。
export type RenderRequestFields = {
  html?: string
}

// docs/spec.md 3.1が`multipart/form-data`を要求しているため、将来pdfファイル送信も
// 同じ関数で扱えるようFormDataを使う（JSON.stringifyのapplication/jsonにはしない）。
export async function renderSheet(fields: RenderRequestFields): Promise<RenderResponse> {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    formData.append(key, value)
  }

  const response = await fetch('/api/render', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    // docs/spec.md 4章のエラーコード定義に沿ってステータスコードを呼び出し側に伝える。
    throw new Error(`/api/render が失敗しました (status: ${response.status})`)
  }

  try {
    return (await response.json()) as RenderResponse
  } catch {
    // 200応答でも本文が空/不正なJSONの場合にSyntaxErrorをそのまま伝播させず、
    // 呼び出し側（sheetStore.fetchRender）に意味の伝わるメッセージを渡す。
    throw new Error('/api/render のレスポンスがJSONとして解釈できませんでした')
  }
}
