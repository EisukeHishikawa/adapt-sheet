import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// ステップ8のE2Eシナリオ（DEVELOPMENT.md）:
// 「PDFアップロード → 描画ボタン押下 → 履歴が横にスライドする」という一連のユーザー行動を
// 実ブラウザ（Chromium）でエミュレートする。
//
// /api/render は page.route でモックし、実バックエンド・実Claude APIには接続しない
// （CLAUDE.md「AI呼び出しのモック」）。呼び出しのたびに異なるhtmlを返すことで、
// 履歴が新しい順に積み上がる様子を検証できるようにしている。

// e2e/fixtures/sample.pdf の絶対パス。ESMには__dirnameがないためimport.meta.urlから解決する。
const SAMPLE_PDF = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url))

test.describe('描画フロー（PDFアップロード→描画→履歴スライド）', () => {
  test('PDFを上げて描画すると履歴が積み上がり、履歴クリックで復元できる', async ({ page }) => {
    // 描画APIをモック。呼び出し回数をカウントし、回ごとに中身の違うHTMLを返す。
    let renderCount = 0
    await page.route('**/api/render', async (route) => {
      renderCount += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          html: `<p data-testid="rendered">描画結果 ${renderCount}</p>`,
          css: 'p { color: #111; }',
          json: { count: renderCount },
        }),
      })
    })

    await page.goto('/')

    // 初期状態は履歴が空でプレースホルダが出ている（履歴サムネイルのボタンは存在しない）。
    await expect(page.getByText('描画すると、ここに履歴が最大10件まで並びます')).toBeVisible()
    await expect(page.getByRole('button', { name: /^履歴 / })).toHaveCount(0)

    // 1) PDFアップロード: input[type=file]へファイルを渡すとonChange経由でストアに格納され、
    //    ドロップゾーンにファイル名が表示される。
    await page.getByLabel('PDFドラッグ＆ドロップエリア').setInputFiles(SAMPLE_PDF)
    await expect(page.getByText('sample.pdf')).toBeVisible()

    // 2) 描画ボタン押下: モックレスポンスがプレビューに反映され、履歴が1件になる。
    await page.getByRole('button', { name: '描画' }).click()
    // トーストは閉じるボタン（×）を内包するため、完全一致ではなく部分一致で本文を検証する。
    await expect(page.getByRole('status')).toContainText('描画が完了しました')
    await expect(page.getByRole('button', { name: '履歴 1' })).toBeVisible()

    // 3) もう一度描画すると履歴が横にスライドして2件並ぶ（最新が先頭=「履歴 1」）。
    await page.getByRole('button', { name: '描画' }).click()
    await expect(page.getByRole('button', { name: /^履歴 / })).toHaveCount(2)

    // 最新の描画（2回目）の内容がプレビューiframeに出ていることを確認する。
    const preview = page.frameLocator('iframe[title="プレビュー"]')
    await expect(preview.getByTestId('rendered')).toHaveText('描画結果 2')

    // 4) 履歴スライドの2件目（1回目の描画=古い方）をクリックすると、その内容へ復元される。
    await page.getByRole('button', { name: '履歴 2' }).click()
    await expect(preview.getByTestId('rendered')).toHaveText('描画結果 1')
  })

  test('APIがエラーを返すとエラートーストが表示される', async ({ page }) => {
    // 500応答をモックし、ステータスコードに対応する日本語メッセージ（想定外エラー）を検証する。
    await page.route('**/api/render', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/')
    await page.getByRole('button', { name: '描画' }).click()

    await expect(page.getByRole('alert')).toContainText('サーバーで想定外のエラーが発生しました。')
    // 閉じるボタンでトーストを消せる。
    await page.getByRole('button', { name: 'メッセージを閉じる' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
