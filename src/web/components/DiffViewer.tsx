import { useMemo, useState } from 'react'
import {
  parseDiff,
  Diff,
  Hunk,
  findChangeByNewLineNumber,
  getChangeKey,
  type ChangeData,
  type HunkData,
  type FileData,
} from 'react-diff-view'

import 'react-diff-view/style/index.css'
import './DiffViewer.css'

interface Props {
  unifiedDiff: string | null
  file: string
  line: number | null
  findingId: string
}

type ExpandLevel = 'window' | 'full'

const WINDOW = 6

function fileMatches(f: FileData, target: string): boolean {
  return (f.newPath ?? '') === target || (f.oldPath ?? '') === target
}

function findContainingHunk(hunks: HunkData[], anchor: number): HunkData | undefined {
  return hunks.find((h) => anchor >= h.newStart && anchor < h.newStart + h.newLines)
}

function changeNewLine(c: ChangeData): number | null {
  if (c.type === 'normal') return c.newLineNumber
  if (c.type === 'insert') return c.lineNumber
  return null
}

function changeOldLine(c: ChangeData): number | null {
  if (c.type === 'normal') return c.oldLineNumber
  if (c.type === 'delete') return c.lineNumber
  return null
}

// Slice a hunk to a window of changes around the anchor's index in the
// changes array. Index-based (not line-based) so that +/- rows near a
// context-line anchor stay visible — see commit 2210d65 for the prior bug.
function trimHunkAround(hunk: HunkData, anchor: number, window: number): HunkData {
  const all = hunk.changes
  if (all.length <= 2 * window + 1) return hunk

  let bestIdx = -1
  let bestDist = Infinity
  for (let i = 0; i < all.length; i++) {
    const c = all[i]
    if (!c) continue
    const ln = changeNewLine(c)
    if (ln == null) continue
    const d = Math.abs(ln - anchor)
    if (d < bestDist) {
      bestIdx = i
      bestDist = d
    }
  }
  if (bestIdx < 0) return hunk

  const start = Math.max(0, bestIdx - window)
  const end = Math.min(all.length, bestIdx + window + 1)
  const sliced = all.slice(start, end)

  let oldStart = Infinity
  let oldLines = 0
  let newStart = Infinity
  let newLines = 0
  for (const c of sliced) {
    const oln = changeOldLine(c)
    const nln = changeNewLine(c)
    if (oln != null) {
      if (oln < oldStart) oldStart = oln
      oldLines++
    }
    if (nln != null) {
      if (nln < newStart) newStart = nln
      newLines++
    }
  }

  return {
    ...hunk,
    changes: sliced,
    oldStart: oldStart === Infinity ? hunk.oldStart : oldStart,
    oldLines,
    newStart: newStart === Infinity ? hunk.newStart : newStart,
    newLines,
  }
}

export function DiffViewer({ unifiedDiff, file, line, findingId }: Props) {
  const [level, setLevel] = useState<ExpandLevel>('window')

  const fileDiff = useMemo<FileData | undefined>(() => {
    if (!unifiedDiff) return undefined
    try {
      const files = parseDiff(unifiedDiff)
      return files.find((f) => fileMatches(f, file))
    } catch {
      return undefined
    }
  }, [unifiedDiff, file])

  const anchor = line ?? 0
  const hunks: HunkData[] = useMemo(() => {
    if (!fileDiff) return []
    if (level === 'full') return fileDiff.hunks
    const h = findContainingHunk(fileDiff.hunks, anchor)
    return h ? [trimHunkAround(h, anchor, WINDOW)] : []
  }, [fileDiff, level, anchor])

  const selectedChanges = useMemo<string[]>(() => {
    if (line == null || hunks.length === 0) return []
    const change = findChangeByNewLineNumber(hunks, line)
    return change ? [getChangeKey(change)] : []
  }, [hunks, line])

  if (!unifiedDiff) {
    return (
      <div
        role="region"
        aria-label={`Code context for finding ${findingId}`}
        className="border-t border-rule px-3 py-2 text-meta text-ink-muted italic"
      >
        Loading diff…
      </div>
    )
  }

  if (!fileDiff) {
    return (
      <div
        role="region"
        aria-label={`Code context for finding ${findingId}`}
        className="border-t border-rule px-3 py-2 text-meta text-ink-muted"
      >
        File not in diff: <span className="font-mono text-ink-secondary">{file}</span>
      </div>
    )
  }

  return (
    <div
      role="region"
      aria-label={`Code context for finding ${findingId}`}
      className="border border-rule rounded-md overflow-hidden bg-sunken"
    >
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-rule">
        <span className="font-mono text-meta text-ink-secondary tabular-nums">
          {file}
          {line ? `:${line}` : ''}
        </span>
        <div className="flex items-center gap-2 text-caps tracking-caps uppercase">
          {level === 'window' ? (
            <button
              type="button"
              onClick={() => setLevel('full')}
              className="text-ink-secondary hover:text-brand transition-colors duration-180 ease-out-quart"
            >
              Expand full file
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setLevel('window')}
              className="text-ink-muted hover:text-ink-primary transition-colors duration-180 ease-out-quart"
            >
              Collapse
            </button>
          )}
        </div>
      </header>
      {hunks.length === 0 ? (
        <div className="px-3 py-2 text-meta text-ink-muted">No diff context near line {line}.</div>
      ) : (
        <Diff
          viewType="unified"
          diffType={fileDiff.type}
          hunks={hunks}
          selectedChanges={selectedChanges}
        >
          {(hs: HunkData[]) => hs.map((h) => <Hunk key={`${h.oldStart}-${h.newStart}`} hunk={h} />)}
        </Diff>
      )}
    </div>
  )
}
