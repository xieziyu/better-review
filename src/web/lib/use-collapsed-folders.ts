import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_PREFIX = 'better-review:files-tree-collapsed:'

function storageKey(sessionId: string): string {
  return STORAGE_PREFIX + sessionId
}

function readStored(sessionId: string | undefined): Set<string> {
  if (!sessionId || typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((p): p is string => typeof p === 'string'))
  } catch {
    return new Set()
  }
}

function persist(sessionId: string | undefined, set: Set<string>): void {
  if (!sessionId || typeof window === 'undefined') return
  try {
    const sorted = [...set].sort()
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(sorted))
  } catch {
    // Quota or disabled storage — collapse state simply won't persist.
  }
}

export interface UseCollapsedFoldersResult {
  isCollapsed: (path: string) => boolean
  toggle: (path: string) => void
}

/**
 * Per-session persisted set of collapsed folder paths in the Files tree.
 *
 * Storage shape: `JSON.stringify(string[])` under
 * `better-review:files-tree-collapsed:<sessionId>`. Missing entry = nothing
 * collapsed (default). `sessionId === undefined` keeps state in-memory only.
 */
export function useCollapsedFolders(sessionId: string | undefined): UseCollapsedFoldersResult {
  const [set, setSet] = useState<Set<string>>(() => readStored(sessionId))
  const sessionRef = useRef(sessionId)

  // Re-read when the caller switches sessions while the component is mounted.
  useEffect(() => {
    if (sessionRef.current === sessionId) return
    sessionRef.current = sessionId
    setSet(readStored(sessionId))
  }, [sessionId])

  const isCollapsed = useCallback((path: string) => set.has(path), [set])

  const toggle = useCallback(
    (path: string) => {
      setSet((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        persist(sessionId, next)
        return next
      })
    },
    [sessionId],
  )

  return { isCollapsed, toggle }
}
