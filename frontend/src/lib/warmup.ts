import { supabase } from '@/lib/supabaseClient'

// 画面を開いた時点で、コールドスタートしがちな依存先を起こしておくための処理（ADR-028）。
// いずれも成功可否は画面の挙動に影響させず、失敗しても黙って諦める（描画操作を妨げないため）。

// backendが署名付きでdocling/pdf2htmlexのLambdaを代理ピングする。両サービスはIAM認証必須の
// Function URL（ADR-026）で、フロントから直接は叩けない。
export async function warmupBackendServices(): Promise<void> {
  try {
    await fetch('/api/warmup', { method: 'POST' })
  } catch {
    // ネットワーク断・バックエンド未起動。ウォームアップの失敗は利用者に伝えない。
  }
}

// 無料プランのSupabaseは一定期間アクセスが無いとプロジェクトが一時停止されるため、
// 最小のクエリでアクセス実績を作る。RLSにより未ログインでは0件が返るが、
// 目的は「アクセスがあった」事実だけなので結果は参照しない。
export async function pingSupabase(): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('render_history').select('id').limit(1)
  } catch {
    // 到達不能・設定不備。ウォームアップの失敗は利用者に伝えない。
  }
}

export async function runWarmup(): Promise<void> {
  await Promise.all([warmupBackendServices(), pingSupabase()])
}
