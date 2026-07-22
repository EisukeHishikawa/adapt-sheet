import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/authStore'

// EngineSelectのgated engine（gemini/claude/openai）を使うにはログインが必要（DEVELOPMENT.md
// ステップ27）。VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY未設定の環境ではisAuthAvailableがfalseに
// なり、ヘッダーには何も表示しない（Supabaseプロジェクト未作成のローカル開発を壊さないため）。
// アカウント作成はscripts/create_user.shによる管理者操作のみのため、新規登録の導線は持たず、
// その旨を未ログイン表示に注記して利用者に明示する（ADR-021）。
// ログイン手段はGoogleアカウントのみで、メールアドレス・パスワードの入力欄は持たない（ADR-022）。

export function AuthPanel() {
  const isAuthAvailable = useAuthStore((state) => state.isAuthAvailable)
  const isInitializing = useAuthStore((state) => state.isInitializing)
  const session = useAuthStore((state) => state.session)
  const error = useAuthStore((state) => state.error)
  const isSubmitting = useAuthStore((state) => state.isSubmitting)
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle)
  const signOut = useAuthStore((state) => state.signOut)

  if (!isAuthAvailable) return null

  // セッション復元が終わるまでは「ログイン」ボタンを出さない。先に未ログイン表示を描くと、
  // 復元完了時にログイン済み表示へ入れ替わってチラつくため（ADR-021）。
  // 高さだけ確保してヘッダーのレイアウトシフトも防ぐ。
  if (isInitializing) return <div className="h-8" aria-hidden="true" />

  if (session) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{session.user?.email}</span>
        <Button variant="ghost" size="sm" onClick={() => signOut()}>
          ログアウト
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={isSubmitting} onClick={() => void signInWithGoogle()}>
          <GoogleMark className="size-3.5" />
          Googleでログイン
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
      <p className="text-[11px] text-muted-foreground">アカウント登録はシステム管理者のみ可能です</p>
    </div>
  )
}

// Googleのブランドカラーを保つため、currentColorではなく公式の4色を固定で塗る。
function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  )
}
