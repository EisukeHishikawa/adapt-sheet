import { supabase } from '@/lib/supabaseClient'
import type { components } from '@/types/api'

type WarmupResponse = components['schemas']['WarmupResponse']

// 画面を開いた時点で、コールドスタートしがちな依存先を起こしておくための処理。

// backendが署名付きでdocling/pdf2htmlexのLambdaを代理ピングする。両サービスはIAM認証必須の
// Function URLで、フロントから直接は叩けない。戻り値はwarmupStoreが描画ボタンの
// 活性/非活性判定に使うため、失敗時はnullを返す（例外は投げない）。
export async function warmupBackendServices(): Promise<WarmupResponse | null> {
  try {
    const res = await fetch('/api/warmup', { method: 'POST' })
    if (!res.ok) return null
    return (await res.json()) as WarmupResponse
  } catch {
    return null
  }
}

// 無料プランのSupabaseは一定期間アクセスが無いとプロジェクトが一時停止されるため、
// 最小のクエリでアクセス実績を作る。RLSにより未ログインでは0件が返るが、
// 目的は「アクセスがあった」事実だけなので結果は参照しない。失敗しても画面の挙動に影響させない。
export async function pingSupabase(): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('render_history').select('id').limit(1)
  } catch {
    // 到達不能・設定不備。ウォームアップの失敗は利用者に伝えない。
  }
}
