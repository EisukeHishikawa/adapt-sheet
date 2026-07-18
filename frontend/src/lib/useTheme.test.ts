import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTheme } from './useTheme'

const STORAGE_KEY = 'adaptsheet-theme'

// matchMediaはjsdomに実装がないため、テストごとにOS設定を模したモックへ差し替える。
function mockPrefersDark(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

describe('useTheme', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('dark')
    mockPrefersDark(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('localStorageに保存済みのテーマがあれば、それを初期値として使う', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark')

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('dark')
  })

  it('localStorage未設定時は、OSの配色設定（prefers-color-scheme: dark）に追従する', () => {
    mockPrefersDark(true)

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('dark')
  })

  it('localStorage未設定かつOSがライトの場合はlightになる', () => {
    mockPrefersDark(false)

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')
  })

  it('toggleで light/dark が切り替わる', () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')

    act(() => result.current.toggle())
    expect(result.current.theme).toBe('dark')

    act(() => result.current.toggle())
    expect(result.current.theme).toBe('light')
  })

  it('テーマの変更をdocument.documentElementの.darkクラスへ反映する', () => {
    const { result } = renderHook(() => useTheme())

    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => result.current.toggle())

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('テーマの変更をlocalStorageへ永続化し、次回の初期値に使われる', () => {
    const { result, unmount } = renderHook(() => useTheme())

    act(() => result.current.toggle())
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark')

    unmount()
    const { result: reloaded } = renderHook(() => useTheme())
    expect(reloaded.current.theme).toBe('dark')
  })

  it('localStorageが参照できない環境でも例外にならず、OS設定へフォールバックする', () => {
    mockPrefersDark(true)
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError（プライベートブラウズ等を想定）')
    })

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('dark')
  })

  it('localStorageへの保存が失敗しても、表示上のテーマ切り替え自体は成立する', () => {
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError（テスト用）')
    })

    const { result } = renderHook(() => useTheme())

    act(() => result.current.toggle())

    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
