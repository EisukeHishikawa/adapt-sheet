import { expect, test } from '@playwright/test'

// ステップ28の残課題（DEVELOPMENT.md）: 認証・DB保存・AI生成が絡む全シナリオのE2E。
//
// 実Supabase・実生成AIには接続せず、次の2点だけをブラウザレベルで用意する。
//   1. sessionStorageへ有効なセッションを直接書き込み、ログイン済み状態から開始する
//      （実際のGoogle OAuthリダイレクトはPlaywrightから再現できないため）。
//      supabase-jsのstorageKeyは`sb-${new URL(VITE_SUPABASE_URL).hostname.split('.')[0]}-auth-token`
//      で決まる（@supabase/supabase-js dist/umd/supabase.js）。
//   2. /api/render/jobs・/api/history はpage.routeでモックする（CLAUDE.md「AI呼び出しのモック」）。
//      DB保存・JWT検証そのものはbackendの結合テスト（test_render_jobs.py・test_history.py・
//      test_auth.py）が担っており、ここではログイン状態がAI生成の非同期ジョブ経路
//      （アップロード不要＝PDF無し）・保存済み履歴の取得（HistorySliderへの自動復元・
//      HistoryArchiveでの一覧表示）へ正しく橋渡しされることを検証する。
//
// VITE_SUPABASE_URL未設定（Supabase Local CLI未起動）の環境ではAuthPanel自体が
// 何も描画しないため、その場合はテストをスキップする（docs/supabase-local-cli-setup.md）。
const SUPABASE_URL = process.env.VITE_SUPABASE_URL

test.describe('ログイン状態でのAI生成・履歴復元フロー', () => {
  test.skip(!SUPABASE_URL, 'VITE_SUPABASE_URLが未設定のため（Supabase Local CLI未起動）スキップ')

  const storageKey = `sb-${new URL(SUPABASE_URL ?? 'http://localhost').hostname.split('.')[0]}-auth-token`
  const fakeSession = {
    access_token: 'e2e-fake-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'e2e-fake-refresh-token',
    user: {
      id: 'e2e-user-id',
      email: 'e2e-user@example.com',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    },
  }

  const savedHistoryRow = {
    id: 'history-row-1',
    engine: 'gemini',
    html: '<p data-testid="rendered">保存済み履歴</p>',
    css: 'p { color: #222; }',
    json: { restored: true },
    width_mm: 210,
    height_mm: 297,
    kind: 'render',
    created_at: new Date().toISOString(),
  }

  test.beforeEach(async ({ page }) => {
    // ページの初期スクリプトより先にセッションを書き込み、authStore.init()の
    // getSession()がこのセッションを復元するようにする。
    await page.addInitScript(
      ({ key, session }) => {
        window.sessionStorage.setItem(key, JSON.stringify(session))
      },
      { key: storageKey, session: fakeSession },
    )
  })

  test('ログイン済みで画面を開くと保存済み履歴が自動復元され、AI生成の非同期ジョブも履歴へ積まれる', async ({
    page,
  }) => {
    // 描画ボタンはwarmupStoreがreadyになるまで無効化される（最大6回・5秒間隔のリトライ）。
    // 実backendの/api/warmupを待たせずに済むよう即座にokを返す。
    await page.route('**/api/warmup', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ docling: 'ok', pdf2htmlex: 'ok', database: 'ok' }),
      })
    })

    // ログイン直後（App.tsxのuseEffect）に一度だけ呼ばれるDB復元。
    let historyCallCount = 0
    await page.route('**/api/history', async (route) => {
      historyCallCount += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([savedHistoryRow]),
      })
    })

    // 生成AI系エンジン（gemini、gated）は非同期ジョブ経路。PDF未添付のため
    // upload-urlは呼ばれず、startRenderJob→getRenderJobStatusの順で呼ばれる。
    await page.route('**/api/render/jobs', async (route) => {
      expect(route.request().method()).toBe('POST')
      const body = JSON.parse(route.request().postData() ?? '{}')
      expect(body.engine).toBe('gemini')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: 'job-e2e-1' }),
      })
    })
    await page.route('**/api/render/jobs/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'done',
          html: '<p data-testid="rendered">AI生成結果</p>',
          css: 'p { color: #333; }',
          json: { generated: true },
        }),
      })
    })

    await page.goto('/')

    // 1) ログイン済み表示（AuthPanel）。復元中の空表示を挟むため、まずログアウトボタンの出現を待つ。
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeVisible()
    await expect(page.getByText('e2e-user@example.com')).toBeVisible()

    // 2) セッション確定後、GET /api/historyから自動復元された1件が履歴スライダーに並ぶ。
    await expect(page.getByRole('button', { name: '履歴 1' })).toBeVisible()
    expect(historyCallCount).toBeGreaterThanOrEqual(1)

    // 3) エンジンをgemini（標準プラン・要ログイン）へ切り替えて描画する。
    // サイズ選択も同じcombobox roleのため、生成エンジン選択のaria-labelで絞り込む。
    // 「Gemini API（無料）」と名前が前方一致してしまうため、説明文で一意に絞り込む。
    await page.getByRole('combobox', { name: '生成エンジン選択：精密復元（無料）' }).click()
    await page.getByRole('option', { name: '標準プランのモデルでより高精度に整形します' }).click()
    await page.getByRole('button', { name: '描画' }).click()

    await expect(page.getByRole('status')).toContainText('描画が完了しました')
    // 復元済みの1件 + 今回の描画結果で2件になる。
    await expect(page.getByRole('button', { name: /^履歴 / })).toHaveCount(2)

    const preview = page.frameLocator('iframe[title="プレビュー"]')
    await expect(preview.getByTestId('rendered')).toHaveText('AI生成結果')

    // 4) 「過去データを見る」を開くと、サーバー保存済みの一覧を取り直して表示する。
    await page.getByRole('button', { name: '過去データを見る' }).click()
    await expect(page.getByRole('dialog', { name: '過去データ' })).toBeVisible()
    await expect(page.getByText(new Date(savedHistoryRow.created_at).toLocaleString('ja-JP'))).toBeVisible()
    await page.getByRole('button', { name: '閉じる' }).click()
    await expect(page.getByRole('dialog', { name: '過去データ' })).toHaveCount(0)

    // 5) ログアウトすると未ログイン表示へ戻り、「過去データを見る」導線も消える。
    // ヘッダーは省スペースのため既定で画面上端の外へ隠れており（AppHeader、-translate-y-full）、
    // 上端へマウスを寄せた時だけスライドで現れる。クリックの前にホバーで出す必要がある。
    await page.mouse.move(640, 2)
    await page.getByRole('button', { name: 'ログアウト' }).click()
    await expect(page.getByRole('button', { name: 'Googleでログイン' })).toBeVisible()
    await expect(page.getByRole('button', { name: '過去データを見る' })).toHaveCount(0)
  })
})
