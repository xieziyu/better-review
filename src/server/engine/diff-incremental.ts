// Wraps `annotateDiffWithLineNumbers` to also flag hunks that landed since
// the prior review. We keep the diff fed to the agent at full base..head;
// the incremental info just decorates hunk headers so the agent can spend
// attention on what's new. When no incremental info is available
// (first-ever review, force-push, fetch failure) the output is byte-for-
// byte identical to the existing annotator — the snapshot tests stay green.

import type { GhCompare } from '../github/gh-client'
import { annotateDiffWithLineNumbers } from './diff-annotator'

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
// Match a `+N,M` or `+N` segment inside the compare patches. Same shape as
// the hunk header but anywhere in the patch text (the compare API returns
// one patch string per file, possibly with multiple hunks).
const PATCH_HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm

export interface IncrementalRange {
  // Filename in the **new** tree (compare API keys files by current name,
  // so renames "just work" when matched against the live diff).
  file: string
  newStart: number
  newEnd: number
}

// Pull `+N,M` ranges out of each compare-file's patch. Files without a
// patch (binary, too-large) contribute nothing and are silently skipped.
export function extractNewHunks(compare: GhCompare): IncrementalRange[] {
  const out: IncrementalRange[] = []
  for (const f of compare.files) {
    if (!f.patch) continue
    PATCH_HUNK_RE.lastIndex = 0
    for (const m of f.patch.matchAll(PATCH_HUNK_RE)) {
      const newStart = Number(m[1])
      const length = m[2] !== undefined ? Number(m[2]) : 1
      if (!Number.isFinite(newStart) || length <= 0) continue
      out.push({
        file: f.filename,
        newStart,
        newEnd: newStart + length - 1,
      })
    }
  }
  return out
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha
}

function fileFromHeader(line: string): string | null {
  // `+++ b/path/to/file.ts` — strip the `+++ b/` (or `+++ ` if no prefix).
  if (!line.startsWith('+++ ')) return null
  const rest = line.slice(4).trim()
  if (rest === '/dev/null') return null
  return rest.startsWith('b/') ? rest.slice(2) : rest
}

function hunkOverlapsAny(
  file: string,
  hunkStart: number,
  hunkEnd: number,
  ranges: IncrementalRange[],
): boolean {
  for (const r of ranges) {
    if (r.file !== file) continue
    if (r.newEnd < hunkStart || r.newStart > hunkEnd) continue
    return true
  }
  return false
}

export function annotateDiffWithIncremental(
  diff: string,
  incremental: IncrementalRange[] | null,
  lastReviewedSha: string | null,
): string {
  const annotated = annotateDiffWithLineNumbers(diff)
  if (!incremental || incremental.length === 0 || !lastReviewedSha) return annotated
  const marker = ` ← NEW since ${shortSha(lastReviewedSha)}`
  const lines = annotated.split('\n')
  let currentFile: string | null = null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const fileFromHdr = fileFromHeader(line)
    if (fileFromHdr) {
      currentFile = fileFromHdr
      continue
    }
    const hunk = HUNK_RE.exec(line)
    if (!hunk) continue
    if (!currentFile) continue
    const newStart = Number(hunk[1])
    const length = hunk[2] !== undefined ? Number(hunk[2]) : 1
    const newEnd = newStart + Math.max(length, 1) - 1
    if (hunkOverlapsAny(currentFile, newStart, newEnd, incremental)) {
      lines[i] = line + marker
    }
  }
  return lines.join('\n')
}
