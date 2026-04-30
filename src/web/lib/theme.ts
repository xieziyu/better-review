export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'better-review:theme'

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  return 'system'
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return pref
}

export function getThemePreference(): ThemePreference {
  return readStoredPreference()
}

function paint(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

export function setThemePreference(pref: ThemePreference): ResolvedTheme {
  if (typeof window !== 'undefined') {
    if (pref === 'system') window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, pref)
  }
  const next = resolveTheme(pref)
  paint(next)
  return next
}

let mediaListener: ((e: MediaQueryListEvent) => void) | null = null

export function applyInitialTheme(): ResolvedTheme {
  const pref = readStoredPreference()
  const resolved = resolveTheme(pref)
  paint(resolved)

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    if (mediaListener) mql.removeEventListener('change', mediaListener)
    mediaListener = (e: MediaQueryListEvent) => {
      if (readStoredPreference() === 'system') {
        paint(e.matches ? 'dark' : 'light')
      }
    }
    mql.addEventListener('change', mediaListener)
  }
  return resolved
}
