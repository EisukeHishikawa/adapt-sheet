import { supabase } from '@/lib/supabaseClient'
import type { components } from '@/types/api'

type WarmupResponse = components['schemas']['WarmupResponse']

// 画面を開いた時点で、コールドスタートしがちな依存先を起こしておくための処理。

// docling/pdf2htmlexはIAM認証必須のFunction URLでフロントから直接は叩けないため、backendに
// 代理ピングさせる。呼び出し側が活性判定に使うため、失敗時は例外ではなくnullを返す。
export async function warmupBackendServices(): Promise<WarmupResponse | null> {
  try {
    const res = await fetch('/api/warmup', { method: 'POST' })
    if (!res.ok) return null
    return (await res.json()) as WarmupResponse
  } catch {
    return null
  }
}

// 無料プランのSupabaseは一定期間アクセスが無いと一時停止されるため、最小のクエリで
// アクセス実績を作る。結果は参照せず、失敗しても画面の挙動に影響させない。
export async function pingSupabase(): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('render_history').select('id').limit(1)
  } catch {
    // 到達不能・設定不備。ウォームアップの失敗は利用者に伝えない。
  }
}
