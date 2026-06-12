import { useCallback, useState } from 'react'

/**
 * A drop-in replacement for `useState<string>` that mirrors the value into
 * `localStorage` under `key`. The initial render reads the stored value (or
 * `initial` when nothing is stored), so the state survives a page refresh.
 *
 * Empty strings are removed from storage rather than written, keeping the
 * "nothing selected" state indistinguishable from "never selected". Storage
 * failures (quota, privacy mode, SSR) degrade gracefully to in-memory state.
 *
 * The setter signature matches the plain-value form of `useState`'s setter;
 * functional updaters are intentionally not supported (callers here always
 * pass concrete values).
 */
export function usePersistedState(key: string, initial = ''): [string, (next: string) => void] {
  const [value, setValue] = useState<string>(() => {
    if (typeof window === 'undefined') return initial
    try {
      return window.localStorage.getItem(key) ?? initial
    } catch {
      return initial
    }
  })

  const set = useCallback(
    (next: string) => {
      setValue(next)
      if (typeof window === 'undefined') return
      try {
        if (next) window.localStorage.setItem(key, next)
        else window.localStorage.removeItem(key)
      } catch {
        // Quota or disabled storage — selection simply won't persist.
      }
    },
    [key],
  )

  return [value, set]
}
