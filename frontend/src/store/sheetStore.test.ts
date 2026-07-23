import { http, HttpResponse } from 'msw'
import { EDIT_SNAPSHOT_DELAY_MS, useSheetStore } from './sheetStore'
import { useAuthStore } from './authStore'
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

// 編集内容を複数件の履歴として残す要件のTDD:
// 「編集した内容は描画結果と同じ履歴列へ、編集中と分かる種別(kind='edit')で積まれる」
// 「連続入力は1件にまとまる」「履歴クリック・描画では保留中の編集を失わない」を固定する。
describe('sheetStore（編集内容の履歴登録）', () => {
  beforeEach(() => {
    // 前のテストが残した待ち時間タイマーを打ち切ってから初期化する（タイマーの取り消しは
    // commitEditSnapshotが行う）。
    useSheetStore.getState().commitEditSnapshot()
    vi.useFakeTimers()
    useSheetStore.setState(initialSheetState)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('編集して一定時間が経つと、kind=editの履歴として登録される', () => {
    useSheetStore.getState().setHtmlContent('<p>editing</p>')
    expect(useSheetStore.getState().history).toHaveLength(0)

    vi.advanceTimersByTime(EDIT_SNAPSHOT_DELAY_MS)

    const history = useSheetStore.getState().history
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ html: '<p>editing</p>', kind: 'edit', seq: 1 })
  })

  it('連続した入力は1件にまとまり、編集を再開すると次の履歴が追加される', () => {
    useSheetStore.getState().setHtmlContent('<p>a</p>')
    vi.advanceTimersByTime(EDIT_SNAPSHOT_DELAY_MS / 2)
    useSheetStore.getState().setHtmlContent('<p>ab</p>')
    vi.advanceTimersByTime(EDIT_SNAPSHOT_DELAY_MS)

    expect(useSheetStore.getState().history).toHaveLength(1)
    expect(useSheetStore.getState().history[0].html).toBe('<p>ab</p>')

    useSheetStore.getState().setJsonContent('{"x":1}')
    vi.advanceTimersByTime(EDIT_SNAPSHOT_DELAY_MS)

    const history = useSheetStore.getState().history
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({ json: '{"x":1}', kind: 'edit', seq: 2 })
  })

  it('編集履歴と描画履歴は同じ最大10件枠を共有し、古い順に破棄される', async () => {
    vi.useRealTimers()
    for (let i = 0; i < 11; i += 1) {
      useSheetStore.getState().setHtmlContent(`<p>${i}</p>`)
      useSheetStore.getState().commitEditSnapshot()
    }

    const history = useSheetStore.getState().history
    expect(history).toHaveLength(10)
    expect(history[0].html).toBe('<p>10</p>')
    expect(history.at(-1)?.html).toBe('<p>1</p>')
  })

  it('内容が変わっていなければ履歴を重複登録しない', () => {
    useSheetStore.getState().setHtmlContent('<p>same</p>')
    vi.advanceTimersByTime(EDIT_SNAPSHOT_DELAY_MS)
    useSheetStore.getState().commitEditSnapshot()

    expect(useSheetStore.getState().history).toHaveLength(1)
  })

  it('待ち時間の途中で履歴を復元しても、編集中の内容は履歴へ残る', () => {
    useSheetStore.setState({
      history: [
        { html: '<p>past</p>', css: '', json: '{}', widthMm: 210, heightMm: 297, seq: 1, kind: 'render' },
      ],
      historySeq: 1,
    })
    useSheetStore.getState().setHtmlContent('<p>editing</p>')

    useSheetStore.getState().restoreFromHistory(0)

    // エディタは選んだ履歴の内容に切り替わる
    expect(useSheetStore.getState().htmlContent).toBe('<p>past</p>')
    // 直前の編集内容は「編集中」の履歴として残っており、クリックで戻せる
    const editEntry = useSheetStore.getState().history.find((item) => item.kind === 'edit')
    expect(editEntry).toMatchObject({ html: '<p>editing</p>' })
  })

  it('描画すると、直前の編集内容と描画結果の両方が履歴に並ぶ', async () => {
    vi.useRealTimers()
    useSheetStore.getState().setHtmlContent('<p>editing</p>')

    await useSheetStore.getState().fetchRender()

    const history = useSheetStore.getState().history
    expect(history[0]).toMatchObject({ html: dummyRenderResponse.html, kind: 'render' })
    expect(history[1]).toMatchObject({ html: '<p>editing</p>', kind: 'edit' })
  })
})

// ログイン時は編集中スナップショットをサーバー（POST /api/history/edit）へも保存し、
// kind='edit'として履歴に残す。未ログイン時は呼び出さない。
describe('sheetStore（編集中スナップショットのサーバー保存）', () => {
  beforeEach(() => {
    useSheetStore.getState().commitEditSnapshot()
    useSheetStore.setState(initialSheetState)
    useAuthStore.setState({ session: null })
  })

  it('ログイン済みなら編集履歴の登録ごとにPOST /api/history/editへ保存する', async () => {
    const requests: { authorization: string | null; body: unknown }[] = []
    server.use(
      http.post('/api/history/edit', async ({ request }) => {
        requests.push({
          authorization: request.headers.get('Authorization'),
          body: await request.json(),
        })
        return new HttpResponse(null, { status: 201 })
      }),
    )
    useAuthStore.setState({ session: { access_token: 'token-xyz' } as never })

    useSheetStore.getState().setHtmlContent('<p>editing</p>')
    useSheetStore.getState().setJsonContent('{"x":1}')
    useSheetStore.getState().commitEditSnapshot()
    await vi.waitFor(() => expect(requests).toHaveLength(1))

    expect(requests[0].authorization).toBe('Bearer token-xyz')
    expect(requests[0].body).toMatchObject({ html: '<p>editing</p>', json: { x: 1 } })
  })

  it('未ログインならサーバーへは保存せず、クライアント側の履歴だけに積む', async () => {
    let called = false
    server.use(
      http.post('/api/history/edit', () => {
        called = true
        return new HttpResponse(null, { status: 201 })
      }),
    )

    useSheetStore.getState().setHtmlContent('<p>editing</p>')
    useSheetStore.getState().commitEditSnapshot()
    await Promise.resolve()

    expect(called).toBe(false)
    expect(useSheetStore.getState().history).toHaveLength(1)
  })

  it('サーバー保存が失敗しても、クライアント側の編集履歴は残る', async () => {
    server.use(http.post('/api/history/edit', () => new HttpResponse(null, { status: 500 })))
    useAuthStore.setState({ session: { access_token: 'token-xyz' } as never })

    useSheetStore.getState().setHtmlContent('<p>editing</p>')
    useSheetStore.getState().commitEditSnapshot()
    await vi.waitFor(() => expect(useSheetStore.getState().history).toHaveLength(1))

    expect(useSheetStore.getState().error).toBeNull()
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

// DEVELOPMENT.md ステップ27のTDD要件: authStoreにログイン済みセッションがある場合、
// fetchRenderがAuthorizationヘッダーへaccess_tokenを載せて送信することを検証する。
describe('sheetStore（ログイン状態の反映・ステップ27）', () => {
  beforeEach(() => {
    useSheetStore.setState(initialSheetState)
    useAuthStore.setState({ session: null })
  })

  it('authStoreにsessionがある場合、Authorizationヘッダーへaccess_tokenを付与する', async () => {
    let capturedAuthorization: string | null = null
    server.use(
      http.post('/api/render', ({ request }) => {
        capturedAuthorization = request.headers.get('Authorization')
        return HttpResponse.json(dummyRenderResponse)
      }),
    )
    useAuthStore.setState({ session: { access_token: 'token-xyz' } as never })

    await useSheetStore.getState().fetchRender()

    expect(capturedAuthorization).toBe('Bearer token-xyz')
  })

  it('authStoreにsessionが無い場合、Authorizationヘッダーを付けない', async () => {
    let capturedAuthorization: string | null = 'not-called'
    server.use(
      http.post('/api/render', ({ request }) => {
        capturedAuthorization = request.headers.get('Authorization')
        return HttpResponse.json(dummyRenderResponse)
      }),
    )

    await useSheetStore.getState().fetchRender()

    expect(capturedAuthorization).toBeNull()
  })
})
