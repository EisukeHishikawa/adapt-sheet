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
