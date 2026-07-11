// プレビュー用にHTMLを組み立てるユーティリティ。CLAUDE.md「固定情報と業務データの分離」規約に対応し、
// 固定テキストはHTMLへ直書き、業務データ（{{key}}）のみJSONと連動させる。

// バックエンドのai_client._PLACEHOLDER_PATTERNと同一にして、「何をテンプレート変数とみなすか」の
// 定義をフロント・バックで一致させる。前後の空白（{{ key }}）は手入力の揺れとして許容する。
const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g

// 業務データはテキストとして表示する想定のため、タグや引用符を解釈させない（XSS・レイアウト崩れの防止）。
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// null/undefinedは空文字にする（キーはあるが値が無い、を空欄として表現する）。
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// html内の {{key}} を jsonText（JSON入力エディタの生テキスト）の値で置換する。
// 不正なJSON（編集途中など）や存在しないキーは置換せず {{key}} を残すことで、プレビューを壊さずに
// ユーザーがJSONの誤りに気づけるようにする。
export function renderTemplate(html: string, jsonText: string): string {
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(jsonText)
    // 配列・数値・null等はキー参照できないため、プレーンなオブジェクトのときだけ置換する。
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return html
    }
    data = parsed as Record<string, unknown>
  } catch {
    return html
  }

  return html.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    // Object.prototype由来のキー（toString等）を誤検出しないようhasOwnPropertyで判定する。
    if (!Object.prototype.hasOwnProperty.call(data, key)) return match
    return escapeHtml(stringifyValue(data[key]))
  })
}

// プレビューiframeのsrcDoc。cssは<style>として末尾に足すだけで<head>の有無に関わらず適用されるため、
// html側の構造を解析・書き換えする必要がない。プレビュー本体と履歴サムネイルで同じ合成規則を使う。
export function composePreviewDocument(html: string, css: string): string {
  return css ? `${html}\n<style>${css}</style>` : html
}
