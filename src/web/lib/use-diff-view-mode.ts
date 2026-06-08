import type { DiffViewMode } from '@shared/types'
import { useCallback, useSyncExternalStore } from 'react'

export type { DiffViewMode }

// Session-only unified/split preference for the Files Changed diff.
//
// Unlike the theme/viewed-files preferences, this is NOT persisted. The default
// lives in `config.diffViewMode` (editable in Settings); the SPA seeds this
// store from it on load via `applyDiffViewModeDefault`. Runtime toggles only
// live in module memory — they survive remounts and route changes within the
// current page, but a full reload returns to the configured default. They are
// never written back to config.
let current: DiffViewMode = 'unified'
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getSnapshot(): DiffViewMode {
  return current
}

function setCurrent(next: DiffViewMode): void {
  if (current === next) return
  current = next
  emit()
}

/**
 * Apply the configured default as the active view mode. Called once the config
 * query resolves and again whenever the user changes the default in Settings.
 * Because it only fires when the *config* value changes, in-session toggles via
 * `setMode` are preserved between config changes but overwritten when the user
 * deliberately saves a new default — i.e. Settings stays the source of truth.
 */
export function applyDiffViewModeDefault(mode: DiffViewMode): void {
  setCurrent(mode)
}

export interface UseDiffViewModeResult {
  mode: DiffViewMode
  setMode: (mode: DiffViewMode) => void
}

export function useDiffViewMode(): UseDiffViewModeResult {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const setMode = useCallback((next: DiffViewMode) => {
    setCurrent(next)
  }, [])
  return { mode, setMode }
}
