import { describe, expect, it } from 'vitest'
import { formatHtml } from './htmlFormatter'

// 精密復元（pdf2htmlexエンジン）は自己完結HTMLを1行で返すことがあるため、
// コードエディタのソース表示用に読みやすく整形するユーティリティを検証する。
describe('formatHtml', () => {
  it('1行のHTMLをタグ単位で改行・インデントする', () => {
    const html = '<div><p>a</p></div><div><p>b</p></div>'
    const formatted = formatHtml(html)

    expect(formatted.split('\n').length).toBeGreaterThan(1)
  })

  it('タグ・テキストの内容自体は変更しない（文字が消えたり増えたりしない）', () => {
    const html = '<div><p>Hello World</p><span>合計:1200円</span></div>'
    const formatted = formatHtml(html)

    expect(formatted.replace(/\s+/g, '')).toBe(html.replace(/\s+/g, ''))
  })

  it('空文字は空文字のまま返す', () => {
    expect(formatHtml('')).toBe('')
  })

  it('すでに整形済みの複数行HTMLも壊さず返す', () => {
    const html = '<div>\n  <p>a</p>\n</div>'
    expect(formatHtml(html)).toContain('<p>a</p>')
  })
})
