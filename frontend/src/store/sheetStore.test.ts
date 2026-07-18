import { http, HttpResponse } from 'msw'
import { useSheetStore } from './sheetStore'
import { dummyRenderResponse } from '@/mocks/handlers'
import { server } from '@/mocks/server'

// DEVELOPMENT.md ステップ8のTDD要件:
// 1. 定型サイズ自動入力（docs/spec.md 2.2「定型サイズ自動入力」の寸法表）
// 2. 履歴スライド機能（最大10件、11件目以降は最古を破棄）
// 3. ステータスコードに準拠したエラー/成功メッセージ
// をUIコンポーネントより先にストアのロジックとして検証する（Red状態から開始）。
const initialSheetState = {
  htmlContent: '',
  cssContent: '',
  jsonContent: '',
  promptContent: '',
  pdfFile: null,
  pdfFileName: null,
  widthMm: null,
  heightMm: null,
  // ADR-015で追加したエンジン選択。setStateは浅いマージのため、リセットに含めないとテスト間で
  // 前回選択したengineが漏れる。
  engine: 'gemini_free' as const,
  history: [],
  // 履歴の通し番号カウンタ。setStateは浅いマージのため、リセットに含めないとテスト間で
  // seqが漏れて番号検証がずれる。
  historySeq: 0,
  // ステップ21: 履歴クリック時の未保存入力の退避スロット。setStateは浅いマージのため、
  // ここに含めないとテスト間でdraftが漏れる。
  draft: null,
  isLoading: false,
  error: null,
  successMessage: null,
}

describe('sheetStore（定型サイズ自動入力）', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
  })

  it.each([
    ['A4', 'tate', 210, 297],
    ['A4', 'yoko', 297, 210],
    ['A5', 'tate', 148, 210],
    ['A5', 'yoko', 210, 148],
    ['B5', 'tate', 182, 257],
    ['B5', 'yoko', 257, 182],
  ] as const)(
    '%s / %s 選択時、widthMm=%d, heightMm=%d が自動入力される',
    (size, orientation, expectedWidth, expectedHeight) => {
      useSheetStore.getState().applySizePreset(size, orientation)

      expect(useSheetStore.getState().widthMm).toBe(expectedWidth)
      expect(useSheetStore.getState().heightMm).toBe(expectedHeight)
    },
  )

  it('setWidthMm/setHeightMmで手動編集した値がそのまま反映される（プリセットを上書き）', () => {
    useSheetStore.getState().applySizePreset('A4', 'tate')
    useSheetStore.getState().setWidthMm(123)
    useSheetStore.getState().setHeightMm(456)

    expect(useSheetStore.getState().widthMm).toBe(123)
    expect(useSheetStore.getState().heightMm).toBe(456)
  })
})

describe('sheetStore（履歴スライド機能）', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
  })

  it('描画に成功するたびに履歴の先頭へ追加される', async () => {
    await useSheetStore.getState().fetchRender()

    expect(useSheetStore.getState().history).toHaveLength(1)
    expect(useSheetStore.getState().history[0]).toMatchObject({
      html: dummyRenderResponse.html,
      css: dummyRenderResponse.css,
      // ステップ16: history[].jsonはJSON入力エディタへ戻せる整形済みテキストとして保持する。
      json: JSON.stringify(dummyRenderResponse.json, null, 2),
    })
  })

  it('11件目の描画で最も古い履歴が破棄され、最大10件を維持する', async () => {
    for (let i = 0; i < 11; i += 1) {
      server.use(
        http.post('/api/render', () =>
          HttpResponse.json({ ...dummyRenderResponse, html: `<p>${i}</p>` }),
        ),
      )
      // 履歴の積み上げ順序を検証するため、あえて直列（await）で1件ずつ描画する。
      await useSheetStore.getState().fetchRender()
    }

    const history = useSheetStore.getState().history
    expect(history).toHaveLength(10)
    // 最新（10番目, html=<p>10</p>）が先頭、最古（0番目, html=<p>0</p>）は破棄されている
    expect(history[0].html).toBe('<p>10</p>')
    expect(history.at(-1)?.html).toBe('<p>1</p>')
  })

  it('履歴番号(seq)は10を超えても振り直さず加算し続け、番号が小さい古い履歴から削除される', async () => {
    for (let i = 1; i <= 11; i += 1) {
      server.use(
        http.post('/api/render', () =>
          HttpResponse.json({ ...dummyRenderResponse, html: `<p>${i}</p>` }),
        ),
      )
      await useSheetStore.getState().fetchRender()
    }

    const history = useSheetStore.getState().history
    // 11回描画したので通し番号は11まで進む（10で頭打ちにならない）。
    expect(useSheetStore.getState().historySeq).toBe(11)
    // 先頭は最新（seq=11）、末尾は残っている中で最古（seq=2）。番号が最小のseq=1は削除済み。
    expect(history[0].seq).toBe(11)
    expect(history.at(-1)?.seq).toBe(2)
    expect(history.some((h) => h.seq === 1)).toBe(false)
  })
})

// ステップ21のバグ修正TDD要件:
// 「履歴サムネイルを押すと、直前まで入力していた未保存の内容が消える」不具合の再発防止。
// 復元前に現在の入力をdraftへ退避し、restoreDraftで元へ戻せることをストアのロジックとして固定する。
describe('sheetStore（履歴クリックで未保存入力を失わない・ステップ21）', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
  })

  it('未保存の入力があるまま履歴を復元すると、その入力がdraftへ退避される', () => {
    useSheetStore.setState({
      history: [{ html: '<p>past</p>', css: '', json: '{}', widthMm: 210, heightMm: 297, seq: 1 }],
      // ユーザーが描画せずに編集中の内容（未保存）
      htmlContent: '<p>editing</p>',
      jsonContent: '{"wip":true}',
    })

    useSheetStore.getState().restoreFromHistory(0)

    // エディタは履歴の内容に切り替わる
    expect(useSheetStore.getState().htmlContent).toBe('<p>past</p>')
    // 直前の未保存入力はdraftとして退避され、失われない
    expect(useSheetStore.getState().draft).toMatchObject({
      html: '<p>editing</p>',
      json: '{"wip":true}',
    })
  })

  it('restoreDraftで退避した未保存入力を元に戻せる', () => {
    useSheetStore.setState({
      history: [{ html: '<p>past</p>', css: '', json: '{}', widthMm: 210, heightMm: 297, seq: 1 }],
      htmlContent: '<p>editing</p>',
      jsonContent: '{"wip":true}',
    })

    useSheetStore.getState().restoreFromHistory(0)
    useSheetStore.getState().restoreDraft()

    expect(useSheetStore.getState().htmlContent).toBe('<p>editing</p>')
    expect(useSheetStore.getState().jsonContent).toBe('{"wip":true}')
  })

  it('復元中の内容（すでに履歴と一致）を再度クリックしても、draftを重複更新しない', () => {
    useSheetStore.setState({
      history: [
        { html: '<p>a</p>', css: '', json: '{}', widthMm: 210, heightMm: 297, seq: 2 },
        { html: '<p>b</p>', css: '', json: '{}', widthMm: 210, heightMm: 297, seq: 1 },
      ],
      htmlContent: '',
      jsonContent: '',
    })

    // 空の状態から履歴aを復元（未保存の意味ある入力が無いのでdraftはnullのまま）
    useSheetStore.getState().restoreFromHistory(0)
    expect(useSheetStore.getState().draft).toBeNull()

    // 復元済み（=履歴と一致）の状態から別の履歴bを復元してもdraftは作られない
    useSheetStore.getState().restoreFromHistory(1)
    expect(useSheetStore.getState().draft).toBeNull()
    expect(useSheetStore.getState().htmlContent).toBe('<p>b</p>')
  })

  it('描画に成功するとdraft（編集中の退避）はクリアされる', async () => {
    useSheetStore.setState({ draft: { html: '<p>old</p>', css: '', json: '{}', widthMm: null, heightMm: null } })

    await useSheetStore.getState().fetchRender()

    expect(useSheetStore.getState().draft).toBeNull()
  })
})

describe('sheetStore（ステータスコード準拠のエラー/成功メッセージ）', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
  })

  it('描画に成功すると成功メッセージが設定され、エラーはnullになる', async () => {
    await useSheetStore.getState().fetchRender()

    expect(useSheetStore.getState().successMessage).toBe('描画が完了しました')
    expect(useSheetStore.getState().error).toBeNull()
  })

  it.each([
    [400, 'リクエスト内容に誤りがあります。入力値をご確認ください。'],
    [403, '現在、この生成AIは登録ユーザーのみご利用いただけます。アカウント機能の追加までお待ちください。'],
    [413, 'PDFファイルのサイズが上限を超えています。'],
    [422, 'PDFの解析に失敗しました。ファイルの内容をご確認ください。'],
    [429, 'リクエストが混み合っています。しばらくしてから再度お試しください。'],
    [502, 'AIによる生成に失敗しました。しばらくしてから再度お試しください。'],
    [500, 'サーバーで想定外のエラーが発生しました。'],
  ])('ステータス%dの場合、規定のエラーメッセージが表示される', async (status, expectedMessage) => {
    server.use(http.post('/api/render', () => new HttpResponse(null, { status })))

    await useSheetStore.getState().fetchRender()

    expect(useSheetStore.getState().error).toBe(expectedMessage)
    expect(useSheetStore.getState().successMessage).toBeNull()
  })

  it('バックエンドの構造化エラーボディのmessageを、ステータス別の既定文言より優先して表示する（ADR-012）', async () => {
    // 既定文言（messageForStatus(502)）とは異なる文言をバックエンドが返すケースを用意し、
    // バックエンド提供のmessageが実際に画面表示用のerrorへ入ることを検証する。
    const backendMessage = 'モデルが混雑しています。数分後に再度お試しください。(#req-xyz)'
    server.use(
      http.post('/api/render', () =>
        HttpResponse.json(
          { error: { code: 'AI_GENERATION_ERROR', message: backendMessage, request_id: 'req-xyz' } },
          { status: 502 },
        ),
      ),
    )

    await useSheetStore.getState().fetchRender()

    expect(useSheetStore.getState().error).toBe(backendMessage)
    expect(useSheetStore.getState().successMessage).toBeNull()
  })

  it('描画を再実行すると、前回の成功/エラーメッセージがクリアされる', async () => {
    useSheetStore.setState({ successMessage: '描画が完了しました', error: null })
    server.use(http.post('/api/render', () => new HttpResponse(null, { status: 500 })))

    const promise = useSheetStore.getState().fetchRender()
    expect(useSheetStore.getState().successMessage).toBeNull()
    await promise
  })
})

// DEVELOPMENT.md ステップ16のTDD要件:
// プロンプト入力欄の値がfetchRenderでバックエンドのリクエスト形式（promptフィールド）と
// 一致する形で送信されること、およびADR-014に基づきcssフィールドが送信されないことを検証する。
// jsonContent（業務データJSON）はGeminiへの入力として不要になったため送信されない
// （backend/app/main.pyのjson_fieldパラメータ廃止と対）。
describe('sheetStore（JSON/プロンプト入力欄の送信・ADR-014）', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
  })

  it('promptContentの値がfetchRenderでリクエストのpromptフィールドとして送信され、jsonContentは送信されない', async () => {
    let capturedFormData: FormData | undefined
    server.use(
      http.post('/api/render', async ({ request }) => {
        capturedFormData = await request.formData()
        return HttpResponse.json(dummyRenderResponse)
      }),
    )
    useSheetStore.setState({
      htmlContent: '<p>x</p>',
      jsonContent: '{"customer_name":"田中"}',
      promptContent: '請求書レイアウトにして',
    })

    await useSheetStore.getState().fetchRender()

    expect(capturedFormData?.get('prompt')).toBe('請求書レイアウトにして')
    // jsonContentはローカルのJSON入力エディタ状態のみで、リクエストには含めない。
    expect(capturedFormData?.has('json')).toBe(false)
    // ADR-014: cssは独立したリクエストフィールドを持たないため、送信されないことを固定する。
    expect(capturedFormData?.has('css')).toBe(false)
  })

  it('描画に成功すると、jsonContentはレスポンスのjsonを整形したテキストで上書きされ、promptContentは変わらない', async () => {
    useSheetStore.setState({ jsonContent: '{}', promptContent: '請求書レイアウトにして' })

    await useSheetStore.getState().fetchRender()

    expect(useSheetStore.getState().jsonContent).toBe(JSON.stringify(dummyRenderResponse.json, null, 2))
    expect(useSheetStore.getState().promptContent).toBe('請求書レイアウトにして')
  })

  it('htmlContentはfetchRenderで送信されない（ADR-015：生成AIへPDFを直接送るため不要）', async () => {
    let capturedFormData: FormData | undefined
    server.use(
      http.post('/api/render', async ({ request }) => {
        capturedFormData = await request.formData()
        return HttpResponse.json(dummyRenderResponse)
      }),
    )
    useSheetStore.setState({ htmlContent: '<p>古いHTML</p>' })

    await useSheetStore.getState().fetchRender()

    expect(capturedFormData?.has('html')).toBe(false)
  })
})

// ADR-015のTDD要件: EngineSelectで選択したengineがfetchRenderのリクエストへ反映されること、
// 既定値がgemini_free（無料枠）であることを検証する。
describe('sheetStore（モデル選択・ADR-015）', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
  })

  it('engineの既定値はgemini_free（無料枠）である', () => {
    expect(useSheetStore.getState().engine).toBe('gemini_free')
  })

  it('setEngineでengineを変更できる', () => {
    useSheetStore.getState().setEngine('claude')

    expect(useSheetStore.getState().engine).toBe('claude')
  })

  it('選択中のengineがfetchRenderでリクエストのengineフィールドとして送信される', async () => {
    let capturedFormData: FormData | undefined
    server.use(
      http.post('/api/render', async ({ request }) => {
        capturedFormData = await request.formData()
        return HttpResponse.json(dummyRenderResponse)
      }),
    )
    useSheetStore.getState().setEngine('pymupdf')

    await useSheetStore.getState().fetchRender()

    expect(capturedFormData?.get('engine')).toBe('pymupdf')
  })
})
