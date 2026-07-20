import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

// DEVELOPMENT.md ステップ27。VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY未設定（lib/supabaseClientが
// null）の環境では、認証系メソッドを呼んでもクラッシュさせず何もしない（AuthPanel自体を
// isAuthAvailable===falseで非表示にするための土台）。
type AuthState = {
  session: Session | null
  isAuthAvailable: boolean
  error: string | null
  isSubmitting: boolean
  init: () => void
  signInWithPassword: (email: string, password: string) => Promise<void>
  signUpWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  dismissError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  isAuthAvailable: supabase !== null,
  error: null,
  isSubmitting: false,
  init: () => {
    if (!supabase) return
    // 起動時点の既存セッション（localStorage永続化分）を取り込む。
    supabase.auth.getSession().then(({ data }) => set({ session: data.session }))
    // ログイン・ログアウト・トークン更新を継続的にsessionへ反映する。
    supabase.auth.onAuthStateChange((_event, session) => set({ session }))
  },
  signInWithPassword: async (email, password) => {
    if (!supabase) return
    set({ isSubmitting: true, error: null })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ isSubmitting: false, error: error.message })
      return
    }
    set({ isSubmitting: false, session: data.session })
  },
  signUpWithPassword: async (email, password) => {
    if (!supabase) return
    set({ isSubmitting: true, error: null })
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) {
      set({ isSubmitting: false, error: error.message })
      return
    }
    // Supabaseのメール確認が有効な場合、signUp直後はsessionがnullのまま返る
    // （確認メールのリンクを踏んだ後に初めてセッションが張られる）。
    set({ isSubmitting: false, session: data.session })
  },
  signOut: async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    set({ session: null })
  },
  dismissError: () => set({ error: null }),
}))
