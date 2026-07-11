import { useEffect, useState } from 'react'

// ステップ21: ライト/ダークテーマの切り替えフック。
// index.cssには`.dark`用のカラートークン（--background等）が定義済みだが、これまで`.dark`を
// 付与する導線が無く常時ライト固定だった。ここで<html>への`.dark`付与を一元管理し、
// ヘッダーのトグルから利用できるようにする（既存の未使用スタイル資産の活用）。
// テーマ選択はlocalStorageへ永続化し、未設定時はOSの配色設定（prefers-color-scheme）に追従する。
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'adaptsheet-theme'

// OSがダーク配色を優先しているか。jsdom等matchMedia非対応環境では常にfalse（=ライト）にフォールバック
// して、参照だけで例外を投げないようにする（テスト環境でのthrow防止）。
function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

// 初期テーマ: localStorageの保存値を最優先し、無ければOS設定に従う。
// localStorageが使えない環境（プライベートブラウズ等）でも落ちないようtry/catchで包む。
function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // 参照不可時はOS設定へフォールバックする
  }
  return prefersDark() ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  // themeの変化を<html>のclassと永続化に反映する。classList.toggleの第2引数で付け外しを一括制御する。
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // 保存不可でも表示切り替え自体は成立するため握りつぶす
    }
  }, [theme])

  const toggle = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))

  return { theme, toggle }
}
