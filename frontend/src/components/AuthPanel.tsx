import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/authStore'

// EngineSelectのgated engine（gemini/claude/openai）を使うにはログインが必要（DEVELOPMENT.md
// ステップ27）。VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY未設定の環境ではisAuthAvailableがfalseに
// なり、ヘッダーには何も表示しない（Supabaseプロジェクト未作成のローカル開発を壊さないため）。
const inputClassName =
  'rounded-md border border-input bg-background px-2 py-1 text-xs placeholder:text-muted-foreground/70 transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40'

export function AuthPanel() {
  const isAuthAvailable = useAuthStore((state) => state.isAuthAvailable)
  const session = useAuthStore((state) => state.session)
  const error = useAuthStore((state) => state.error)
  const isSubmitting = useAuthStore((state) => state.isSubmitting)
  const signInWithPassword = useAuthStore((state) => state.signInWithPassword)
  const signUpWithPassword = useAuthStore((state) => state.signUpWithPassword)
  const signOut = useAuthStore((state) => state.signOut)
  const dismissError = useAuthStore((state) => state.dismissError)

  const [isOpen, setIsOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (!isAuthAvailable) return null

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

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          dismissError()
          setIsOpen(true)
        }}
      >
        ログイン
      </Button>
    )
  }

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        void signInWithPassword(email, password)
      }}
    >
      <label className="sr-only" htmlFor="auth-email">
        メールアドレス
      </label>
      <input
        id="auth-email"
        type="email"
        required
        placeholder="メールアドレス"
        className={`${inputClassName} w-36`}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <label className="sr-only" htmlFor="auth-password">
        パスワード
      </label>
      <input
        id="auth-password"
        type="password"
        required
        placeholder="パスワード"
        className={`${inputClassName} w-28`}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={isSubmitting}>
        ログイン
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isSubmitting}
        onClick={() => signUpWithPassword(email, password)}
      >
        新規登録
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
        閉じる
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  )
}
