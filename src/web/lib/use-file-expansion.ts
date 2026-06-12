import { useCallback, useEffect, useRef, useState } from 'react'
import { insertHunk, textLinesToHunk, type HunkData } from 'react-diff-view'

import { api } from './api'

export type ExpansionStatus = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface FileExpansion {
  /** Hunks with any expanded context materialized into them. */
  hunks: HunkData[]
  /** Total NEW-side line count of the file, known once raw content loads. */
  totalLines: number | null
  status: ExpansionStatus
  /**
   * Reveal NEW-side lines [newStart, newEnd) as context, numbering the old
   * side from `oldStart` (the gap is unchanged, so old/new advance in lockstep).
   * No-op (and triggers a one-time raw fetch) until content is available.
   */
  expand: (newStart: number, newEnd: number, oldStart: number) => void
  /** Expand the entire collapsed gap that contains the given NEW-side line. */
  expandGapContaining: (newLine: number) => void
}

// We fetch the file at the PR head (NEW side) once — cheap for worktree /
// snapshot disk reads; a single cached gh blob otherwise — then materialize
// hidden context from it.
//
// IMPORTANT: react-diff-view's expandFromRawCode indexes its source by OLD
// line numbers, so it expects the *base* file. We only have the head file, so
// we build the revealed lines directly in NEW-side coordinates with
// textLinesToHunk + insertHunk. Collapsed gaps are unchanged regions, so head
// content matches base content there and the only thing that differs is the
// old/new line numbering — captured by the constant offset between them.
function buildExpansion(
  prev: HunkData[],
  rawLines: string[],
  newStart: number,
  newEnd: number,
  oldStart: number,
): HunkData[] {
  const slice = rawLines.slice(Math.max(newStart, 1) - 1, newEnd - 1)
  if (slice.length === 0) return prev
  const hunk = textLinesToHunk(slice, oldStart, newStart)
  return hunk ? insertHunk(prev, hunk) : prev
}

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
    (newStart: number, newEnd: number, oldStart: number) => {
      void (async () => {
        const raw = await ensureRaw()
        if (!raw) return
        setHunks((prev) => buildExpansion(prev, raw, newStart, newEnd, oldStart))
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
          // Locate the collapsed gap (new-side) holding `newLine` and reveal it
          // fully. Old-side start comes from the previous hunk's end (or 1).
          for (let i = 0; i < prev.length; i++) {
            const hunk = prev[i]
            if (!hunk) continue
            const prevHunk = i === 0 ? null : (prev[i - 1] ?? null)
            const gapNewStart = prevHunk ? prevHunk.newStart + prevHunk.newLines : 1
            const gapNewEnd = hunk.newStart // exclusive
            if (gapNewEnd <= gapNewStart) continue
            if (newLine >= gapNewStart && newLine < gapNewEnd) {
              const gapOldStart = prevHunk ? prevHunk.oldStart + prevHunk.oldLines : 1
              return buildExpansion(prev, raw, gapNewStart, gapNewEnd, gapOldStart)
            }
          }
          // Past the last hunk (trailing gap).
          const last = prev[prev.length - 1]
          if (last) {
            const gapNewStart = last.newStart + last.newLines
            if (newLine >= gapNewStart) {
              const gapOldStart = last.oldStart + last.oldLines
              return buildExpansion(prev, raw, gapNewStart, raw.length + 1, gapOldStart)
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
