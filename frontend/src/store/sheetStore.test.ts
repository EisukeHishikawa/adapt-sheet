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
  jsonContent: {},
  pdfFile: null,
  pdfFileName: null,
  widthMm: null,
  heightMm: null,
  history: [],
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
      json: dummyRenderResponse.json,
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

  it('描画を再実行すると、前回の成功/エラーメッセージがクリアされる', async () => {
    useSheetStore.setState({ successMessage: '描画が完了しました', error: null })
    server.use(http.post('/api/render', () => new HttpResponse(null, { status: 500 })))

    const promise = useSheetStore.getState().fetchRender()
    expect(useSheetStore.getState().successMessage).toBeNull()
    await promise
  })
})
