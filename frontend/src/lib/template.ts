// プレビューでHTMLのテンプレート変数 {{key}} を、JSON入力の値へリアルタイム置換するユーティリティ。
// CLAUDE.md「固定情報と業務データの分離」規約に対応し、タイトル等の固定テキストはHTMLへ直書き、
// 明細等の業務データ（{{key}}）のみJSONと連動させる。これにより、JSON入力を編集すると
// 該当するプレビュー箇所だけが動的に変わる（docs/spec.md 2.2「リアルタイム双方向プレビュー」）。
//
// 置換対象の {{key}} 形式は、バックエンドの ai_client._PLACEHOLDER_PATTERN と同一にして、
// フロント・バックで「何をテンプレート変数とみなすか」の定義を1対1で一致させる。
// \w は英数字とアンダースコアで、customer_name のようなキーを対象にする。
// 前後の空白（{{ key }}）も許容して、手入力時の揺れに寛容にする。
const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g

// 値をHTMLへ差し込む際の特殊文字エスケープ。業務データはテキストとして表示する想定のため、
// タグや引用符をそのまま解釈させず（XSS・レイアウト崩れの防止）、リテラル文字として描画する。
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// JSONの値を表示用文字列へ変換する。string/number/booleanはそのまま文字列化し、
// オブジェクト・配列はJSON文字列にして埋め込む（明細のような構造データを想定）。
// null/undefinedは空文字にする（キーは存在するが値が無い、を空欄として表現）。
function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// html内の {{key}} を、jsonText（JSON入力エディタの生テキスト）の対応する値で置換して返す。
// - jsonTextが不正（編集途中など）・オブジェクトでない場合は、htmlをそのまま返してプレビューを壊さない。
//   （置換に失敗しても {{key}} が見えたままになり、ユーザーがJSONの誤りに気づける）
// - JSONに存在しないキーは {{key}} のまま残す（未設定であることを可視化する）。
export function renderTemplate(html: string, jsonText: string): string {
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(jsonText)
    // 配列や数値・null等はキー参照できないため、プレーンなオブジェクトのときだけ置換する。
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return html
    }
    data = parsed as Record<string, unknown>
  } catch {
    // 空文字や編集途中の不正JSONはここに来る。置換せず元のHTMLを返す。
    return html
  }

  return html.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    // 存在しないキーはプレースホルダを残す（Object.prototype由来のキー誤検出も防ぐ）。
    if (!Object.prototype.hasOwnProperty.call(data, key)) return match
    return escapeHtml(stringifyValue(data[key]))
  })
}
