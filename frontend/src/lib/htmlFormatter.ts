import * as beautify from 'js-beautify'

const FORMAT_OPTIONS: Parameters<typeof beautify.html>[1] = {
  indent_size: 2,
  wrap_line_length: 0,
}

export function formatHtml(html: string): string {
  if (!html) return html
  return beautify.html(html, FORMAT_OPTIONS)
}
