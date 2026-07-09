import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenderApiError, renderSheet } from './api'
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

  // DEVELOPMENT.md ステップ16のTDD要件: json/promptフィールドがFormDataに正しく含まれること、
  // およびADR-019に基づきcssフィールドを持たないRenderRequestFieldsからは
  // cssが送信されようがないことを検証する。
  it('json/promptフィールドが渡された場合、FormDataにそのまま含めて送信する', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(dummyRenderResponse), { status: 200 }))

    await renderSheet({ html: '<p>x</p>', json: '{"a":1}', prompt: '請求書レイアウトにして' })

    const [, init] = fetchSpy.mock.calls[0]
    const formData = init?.body as FormData
    expect(formData.get('json')).toBe('{"a":1}')
    expect(formData.get('prompt')).toBe('請求書レイアウトにして')
    expect(formData.has('css')).toBe(false)
  })
})

// DEVELOPMENT.md ステップ14（ADR-017）のTDD要件: バックエンドの構造化エラーボディ
// `{"error": {code, message, request_id}}` を RenderApiError が保持できることを検証する。
describe('renderSheet（構造化エラーレスポンスの伝播）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('構造化エラーボディのcode/message/request_idをRenderApiErrorに保持する', async () => {
    const errorBody = {
      error: {
        code: 'AI_GENERATION_ERROR',
        message: 'AIによる生成に失敗しました。しばらくしてから再度お試しください。',
        request_id: 'test-request-id-1234',
      },
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(errorBody), {
        status: 502,
        headers: { 'X-Request-ID': 'test-request-id-1234' },
      }),
    )

    // rejectされたRenderApiErrorのプロパティを検証する。
    await expect(renderSheet({ html: '<p>x</p>' })).rejects.toMatchObject({
      status: 502,
      code: 'AI_GENERATION_ERROR',
      backendMessage: 'AIによる生成に失敗しました。しばらくしてから再度お試しください。',
      requestId: 'test-request-id-1234',
    })
  })

  it('ボディが空（バックエンド不達等）の場合、backendMessageはnullでステータスのみ保持する', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }))

    // 例外の型と、フォールバック用にstatusが取れることを確認する。
    await expect(renderSheet({ html: '<p>x</p>' })).rejects.toBeInstanceOf(RenderApiError)
    await expect(renderSheet({ html: '<p>x</p>' })).rejects.toMatchObject({
      status: 500,
      backendMessage: null,
    })
  })
})
