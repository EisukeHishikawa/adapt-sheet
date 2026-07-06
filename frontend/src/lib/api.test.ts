import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderSheet } from './api'
import { dummyRenderResponse } from '@/mocks/handlers'

// DEVELOPMENT.md ステップ7のTDD要件: PDFがrenderSheet経由でリクエストに正しく
// 含まれることを検証する。MSW（Node環境）でFile入りのFormDataをHTTPボディへ
// エンコードする際、jsdomのFileとundiciのFile実装がかみ合わず例外になる既知の制約があるため
// （App.test.tsx参照）、ここではfetch自体をモックしてFormDataの中身を直接検証する。
describe('renderSheet', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('pdfフィールドが渡された場合、FormDataにファイルとしてそのまま含めて送信する', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(dummyRenderResponse), { status: 200 }))

    const file = new File(['%PDF-1.4 dummy'], 'invoice.pdf', { type: 'application/pdf' })
    await renderSheet({ html: '<p>x</p>', pdf: file })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/render')
    const formData = init?.body as FormData
    expect(formData.get('html')).toBe('<p>x</p>')
    expect(formData.get('pdf')).toBe(file)
  })

  it('pdfが渡されない場合、FormDataにpdfキーを含めない', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(dummyRenderResponse), { status: 200 }))

    await renderSheet({ html: '<p>x</p>' })

    const [, init] = fetchSpy.mock.calls[0]
    const formData = init?.body as FormData
    expect(formData.has('pdf')).toBe(false)
  })
})
