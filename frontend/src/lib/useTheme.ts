import { useEffect, useState } from 'react'

// ライト/ダークテーマの切り替え。<html>への`.dark`付与（index.cssのカラートークンが切り替わる）を
// ここへ一元化する。選択はlocalStorageへ永続化し、未設定時はOSの配色設定に追従する。
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'adaptsheet-theme'

// jsdom等matchMedia非対応環境でも参照だけで例外を投げないようフォールバックする。
function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

// localStorageが使えない環境（プライベートブラウズ等）でも落ちないようtry/catchで包む。
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // 参照不可時はOS設定へフォールバックする。
  }
  return prefersDark() ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // 保存できなくても表示の切り替え自体は成立するため握りつぶす。
    }
  }, [theme])

  const toggle = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))

  return { theme, toggle }
}
