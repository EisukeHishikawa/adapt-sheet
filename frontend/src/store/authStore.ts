import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

// DEVELOPMENT.md ステップ27。VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY未設定（lib/supabaseClientが
// null）の環境では、認証系メソッドを呼んでもクラッシュさせず何もしない（AuthPanel自体を
// isAuthAvailable===falseで非表示にするための土台）。
// アカウント作成はscripts/create_user.shによる管理者操作のみとし、画面からの新規登録は提供しない
// （ADR-021）。ログイン手段はGoogleアカウントのみで、パスワードログインは持たない（ADR-022）。
type AuthState = {
  session: Session | null
  isAuthAvailable: boolean
  // 既存セッションの復元が終わるまでtrue。未確定のままログインUIを描くと、復元後に
  // ログイン済み表示へ入れ替わって「チラつき」が出るため、確定するまで描画を保留する。
  isInitializing: boolean
  error: string | null
  isSubmitting: boolean
  init: () => () => void
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  dismissError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isAuthAvailable: supabase !== null,
  isInitializing: supabase !== null,
  error: null,
  isSubmitting: false,
  init: () => {
    if (!supabase) {
      set({ isInitializing: false })
      return () => {}
    }
    // 起動時点の既存セッション（sessionStorage永続化分）を取り込む。取得に失敗しても
    // 未ログインとして復元を打ち切る（UIが復元待ちのまま固まらないようにする）。
    void supabase.auth
      .getSession()
      .then(({ data }) => set({ session: data.session }))
      .catch(() => set({ session: null }))
      .finally(() => set({ isInitializing: false }))
    // ログイン・ログアウト・トークン更新を継続的にsessionへ反映する。購読解除関数を呼び出し側へ
    // 返し、StrictModeの二重実行やアンマウントでリスナーが増え続けないようにする。
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      set({ session })
      // リフレッシュトークンが失効した場合もSIGNED_OUTで届く。手動ログアウトと区別できないため
      // メッセージは出さず、直前のエラー表示だけ消してログイン前の状態へ戻す。
      if (event === 'SIGNED_OUT') set({ error: null })
    })
    return () => data.subscription.unsubscribe()
  },
  signInWithGoogle: async () => {
    if (!supabase) return
    set({ isSubmitting: true, error: null })
    // 成功時はGoogleの同意画面へ遷移するため、以降の状態更新は戻り先での
    // detectSessionInUrl＋onAuthStateChangeが担う（ここではisSubmittingを戻さない）。
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) set({ isSubmitting: false, error: error.message })
  },
  signOut: async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    set({ session: null })
  },
  dismissError: () => set({ error: null }),
}))
