import { describe, expect, it } from 'vitest'
import { formatCss, formatHtml, formatJson } from './codeFormatter'

// 精密復元（pdf2htmlexエンジン）は自己完結HTMLを1行で返すことがあるため、
// コードエディタのソース表示用に読みやすく整形するユーティリティを検証する。
// CSS・JSONも同様に1行で入ってくることがあるため、同じ方針で整形する。
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

describe('formatCss', () => {
  it('1行のCSSをルール単位で改行・インデントする', () => {
    const css = 'body { color: red; } .a { font-size: 12px; }'
    const formatted = formatCss(css)

    expect(formatted.split('\n').length).toBeGreaterThan(1)
  })

  it('プロパティの値自体は変更しない', () => {
    const css = '.total { color: #ff0000; }'
    expect(formatCss(css)).toContain('#ff0000')
  })

  it('空文字は空文字のまま返す', () => {
    expect(formatCss('')).toBe('')
  })
})

describe('formatJson', () => {
  it('1行のJSONをキー単位で改行・インデント（2スペース）する', () => {
    const json = '{"a":1,"b":{"c":2}}'
    expect(formatJson(json)).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}')
  })

  it('不正なJSON（編集途中など）はプレビューを壊さないよう元の文字列のまま返す', () => {
    expect(formatJson('{ invalid json')).toBe('{ invalid json')
  })

  it('空文字は空文字のまま返す', () => {
    expect(formatJson('')).toBe('')
  })
})
