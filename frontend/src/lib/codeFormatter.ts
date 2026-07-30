import * as beautify from 'js-beautify'

const HTML_FORMAT_OPTIONS: Parameters<typeof beautify.html>[1] = {
  indent_size: 2,
  wrap_line_length: 0,
}

const CSS_FORMAT_OPTIONS: Parameters<typeof beautify.css>[1] = {
  indent_size: 2,
}

export function formatHtml(html: string): string {
  if (!html) return html
  return beautify.html(html, HTML_FORMAT_OPTIONS)
}

export function formatCss(css: string): string {
  if (!css) return css
  return beautify.css(css, CSS_FORMAT_OPTIONS)
}

export function formatJson(json: string): string {
  if (!json) return json
  try {
    return JSON.stringify(JSON.parse(json), null, 2)
  } catch {
    // 編集途中などの不正なJSONはrenderTemplateと同じ「壊さず元の値を返す」方針にする。
    return json
  }
}
