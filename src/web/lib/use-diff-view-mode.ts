import { useCallback, useState } from 'react'

export type DiffViewMode = 'unified' | 'split'

const STORAGE_KEY = 'better-review:diff-view-mode:v1'
const DEFAULT_MODE: DiffViewMode = 'unified'

function readStored(): DiffViewMode {
  if (typeof window === 'undefined') return DEFAULT_MODE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === 'split' || raw === 'unified' ? raw : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

function persist(mode: DiffViewMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Quota or disabled storage — the choice simply won't persist.
  }
}

export interface UseDiffViewModeResult {
  mode: DiffViewMode
  setMode: (mode: DiffViewMode) => void
}

/**
 * Globally persisted unified/split preference for the Files Changed diff.
 *
 * The choice is not session-scoped (a reviewer's preferred layout carries
 * across PRs), so it lives under a single key like the theme preference rather
 * than the per-session `use-viewed-files` storage.
 */
export function useDiffViewMode(): UseDiffViewModeResult {
  const [mode, setModeState] = useState<DiffViewMode>(readStored)

  const setMode = useCallback((next: DiffViewMode) => {
    setModeState(next)
    persist(next)
  }, [])

  return { mode, setMode }
}
