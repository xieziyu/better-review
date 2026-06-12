import { useCallback, useEffect, useRef, useState } from 'react'
import { expandFromRawCode, getCollapsedLinesCountBetween, type HunkData } from 'react-diff-view'

import { api } from './api'

export type ExpansionStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface FileExpansion {
  /** Hunks with any expanded context materialized into them. */
  hunks: HunkData[]
  /** Total line count of the file (old side), known once raw content loads. */
  totalLines: number | null
  status: ExpansionStatus
  /**
   * Expand the half-open OLD-side line range [start, end) into the hunks.
   * No-op (and triggers a one-time raw fetch) until content is available.
   */
  expand: (start: number, end: number) => void
  /** Expand the entire collapsed gap that contains the given NEW-side line. */
  expandGapContaining: (newLine: number) => void
}

// react-diff-view's expandFromRawCode treats `end` as exclusive (slice
// semantics) over OLD-side line numbers; getCollapsedLinesCountBetween counts
// the hidden lines in a gap. This hook fetches the full file once (cheap for
// worktree/snapshot disk reads; a single cached gh blob otherwise) so every
// expander click is synchronous afterwards.
export function useFileExpansion(
  sessionId: string,
  filePath: string,
  baseHunks: HunkData[],
): FileExpansion {
  const [hunks, setHunks] = useState<HunkData[]>(baseHunks)
  const [status, setStatus] = useState<ExpansionStatus>('idle')
  const rawRef = useRef<string[] | null>(null)
  const [totalLines, setTotalLines] = useState<number | null>(null)

  // Reset when the file or its base diff changes (new file selected, or the
  // session diff refetched). Raw content is re-fetched lazily for the new file.
  useEffect(() => {
    setHunks(baseHunks)
    rawRef.current = null
    setTotalLines(null)
    setStatus('idle')
  }, [sessionId, filePath, baseHunks])

  const ensureRaw = useCallback(async (): Promise<string[] | null> => {
    if (rawRef.current) return rawRef.current
    setStatus('loading')
    const content = await api.getSessionFile(sessionId, filePath)
    if (content == null) {
      setStatus('unavailable')
      return null
    }
    const lines = content.split('\n')
    // Drop a single trailing empty produced by a final newline so the
    // bottom-of-file expander doesn't offer a phantom blank line.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    rawRef.current = lines
    setTotalLines(lines.length)
    setStatus('ready')
    return lines
  }, [sessionId, filePath])

  const expand = useCallback(
    (start: number, end: number) => {
      void (async () => {
        const raw = await ensureRaw()
        if (!raw) return
        setHunks((prev) => expandFromRawCode(prev, raw, start, end))
      })()
    },
    [ensureRaw],
  )

  const expandGapContaining = useCallback(
    (newLine: number) => {
      void (async () => {
        const raw = await ensureRaw()
        if (!raw) return
        setHunks((prev) => {
          // Locate the collapsed gap holding `newLine` (new-side) and expand it
          // fully in OLD-side coordinates, which is what expandFromRawCode wants.
          for (let i = 0; i < prev.length; i++) {
            const hunk = prev[i]
            if (!hunk) continue
            const newStart = hunk.newStart
            const prevHunk = i === 0 ? null : (prev[i - 1] ?? null)
            const collapsed = getCollapsedLinesCountBetween(prevHunk, hunk)
            if (collapsed <= 0) continue
            // New-side span of this gap: just below the previous hunk up to
            // just above the current hunk's first line.
            const gapNewEnd = newStart - 1
            const gapNewStart = prevHunk ? prevHunk.newStart + prevHunk.newLines : 1
            if (newLine >= gapNewStart && newLine <= gapNewEnd) {
              const gapOldStart = prevHunk ? prevHunk.oldStart + prevHunk.oldLines : 1
              const gapOldEnd = hunk.oldStart // exclusive
              return expandFromRawCode(prev, raw, gapOldStart, gapOldEnd)
            }
          }
          // Past the last hunk (trailing gap).
          const last = prev[prev.length - 1]
          if (last && raw.length > 0) {
            const lastNewEnd = last.newStart + last.newLines - 1
            if (newLine > lastNewEnd) {
              const oldStart = last.oldStart + last.oldLines
              return expandFromRawCode(prev, raw, oldStart, raw.length + 1)
            }
          }
          return prev
        })
      })()
    },
    [ensureRaw],
  )

  return { hunks, totalLines, status, expand, expandGapContaining }
}
