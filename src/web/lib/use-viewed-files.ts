import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_PREFIX = 'better-review:files-viewed:'

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
    // Quota or disabled storage — viewed state simply won't persist.
  }
}

export interface UseViewedFilesResult {
  /** Live set of canonical file paths marked viewed. */
  viewed: Set<string>
  isViewed: (path: string) => boolean
  toggle: (path: string) => void
  viewedCount: number
}

/**
 * Per-session persisted set of file paths the reviewer marked as "viewed" in
 * the Files Changed tab.
 *
 * Storage shape: `JSON.stringify(string[])` under
 * `better-review:files-viewed:<sessionId>`. Missing entry = nothing viewed
 * (default). `sessionId === undefined` keeps state in-memory only.
 *
 * The diff is immutable for a session's lifetime (one pinned PR head SHA), and
 * a rerun creates a fresh session id, so viewed state resets per review round
 * without any GitHub-style "auto-uncheck on file change" logic.
 */
export function useViewedFiles(sessionId: string | undefined): UseViewedFilesResult {
  const [set, setSet] = useState<Set<string>>(() => readStored(sessionId))
  const sessionRef = useRef(sessionId)

  // Re-read when the caller switches sessions while the component is mounted.
  useEffect(() => {
    if (sessionRef.current === sessionId) return
    sessionRef.current = sessionId
    setSet(readStored(sessionId))
  }, [sessionId])

  const isViewed = useCallback((path: string) => set.has(path), [set])

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

  return useMemo(
    () => ({ viewed: set, isViewed, toggle, viewedCount: set.size }),
    [set, isViewed, toggle],
  )
}
