import { describe, expect, it } from 'vitest'
import { renderTemplate } from './template'

// docs/spec.md 2.2「リアルタイム双方向プレビュー」/ CLAUDE.md「固定情報と業務データの分離」の検証。
// プレビューはHTML内のテンプレート変数 {{key}} を、JSON入力の値で置換して表示する。
// 置換対象・非対象・不正JSON時のフォールバックを、バックエンドの_PLACEHOLDER_PATTERNと
// 同じ {{key}} 契約に沿って固定する。
describe('renderTemplate', () => {
  it('{{key}}をJSONの対応する値で置換する', () => {
    const html = '<h1>帳票タイトル</h1><p>{{customer_name}}</p>'
    const json = JSON.stringify({ customer_name: 'モック太郎' })
    expect(renderTemplate(html, json)).toBe('<h1>帳票タイトル</h1><p>モック太郎</p>')
  })

  it('同じキーが複数回出現する場合はすべて置換する', () => {
    const html = '{{name}}様、{{name}}様宛'
    const json = JSON.stringify({ name: '田中' })
    expect(renderTemplate(html, json)).toBe('田中様、田中様宛')
  })

  it('数値・真偽値は文字列化して置換する', () => {
    const html = '合計:{{total}} 課税:{{taxable}}'
    const json = JSON.stringify({ total: 1200, taxable: true })
    expect(renderTemplate(html, json)).toBe('合計:1200 課税:true')
  })

  it('JSONに存在しないキーは{{key}}のまま残す（消さずに未設定と分かるようにする）', () => {
    const html = '{{known}} / {{unknown}}'
    const json = JSON.stringify({ known: 'あり' })
    expect(renderTemplate(html, json)).toBe('あり / {{unknown}}')
  })

  it('値のHTML特殊文字はエスケープして注入・レイアウト崩れを防ぐ', () => {
    const html = '<p>{{note}}</p>'
    const json = JSON.stringify({ note: '<script>alert(1)</script>' })
    expect(renderTemplate(html, json)).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })

  it('JSONが不正（編集途中など）な場合はHTMLをそのまま返す（プレビューを壊さない）', () => {
    const html = '<p>{{customer_name}}</p>'
    expect(renderTemplate(html, '{ invalid json')).toBe('<p>{{customer_name}}</p>')
    expect(renderTemplate(html, '')).toBe('<p>{{customer_name}}</p>')
  })

  it('JSONがオブジェクトでない（配列・数値など）場合もHTMLをそのまま返す', () => {
    const html = '<p>{{x}}</p>'
    expect(renderTemplate(html, '[1,2,3]')).toBe('<p>{{x}}</p>')
    expect(renderTemplate(html, '42')).toBe('<p>{{x}}</p>')
  })

  it('オブジェクト・配列の値はJSON文字列化して埋め込む', () => {
    const html = '<pre>{{items}}</pre>'
    const json = JSON.stringify({ items: [{ n: 1 }] })
    expect(renderTemplate(html, json)).toBe('<pre>[{&quot;n&quot;:1}]</pre>')
  })
})
