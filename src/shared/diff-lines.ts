// New-side line / line-range membership checks against a unified diff.
// Used by the server (payload-builder, to split inline-eligible findings
// from PR-wide ones) and by the web SubmitDrawer (to preview that same
// split) — keep both on this one implementation so they can never
// disagree about what is inline-eligible.

interface FileHunks {
  ranges: Array<{ start: number; length: number }>
}

function parseDiff(diff: string): Map<string, FileHunks> {
  const map = new Map<string, FileHunks>()
  const lines = diff.split('\n')
  let curFile: string | null = null
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      curFile = line.slice('+++ b/'.length)
      if (!map.has(curFile)) map.set(curFile, { ranges: [] })
      continue
    }
    if (line.startsWith('+++ ')) {
      curFile = null
      continue
    }
    if (line.startsWith('@@') && curFile) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line)
      if (m) {
        const start = Number(m[1])
        const length = m[2] ? Number(m[2]) : 1
        const hunks = map.get(curFile)
        if (!hunks) continue
        hunks.ranges.push({ start, length })
      }
    }
  }
  return map
}

export function isLineInDiff(diff: string, file: string, line: number): boolean {
  const hunks = parseDiff(diff).get(file)
  if (!hunks) return false
  return hunks.ranges.some((r) => line >= r.start && line < r.start + r.length)
}

export function isLineRangeInDiff(
  diff: string,
  file: string,
  startLine: number,
  endLine: number,
): boolean {
  const hunks = parseDiff(diff).get(file)
  if (!hunks) return false
  for (let l = startLine; l <= endLine; l++) {
    if (!hunks.ranges.some((r) => l >= r.start && l < r.start + r.length)) return false
  }
  return true
}

// Inline-eligibility for a finding anchored at `line` with an optional
// multi-line `startLine`: a range finding (startLine < line) needs the
// whole startLine..line span on the diff's new side; a single-line
// finding only needs its own line. This is THE decision both the submit
// payload-builder and the SubmitDrawer preview must share — call this,
// not the two primitives above, so the preview can never disagree with
// what actually gets posted inline.
export function isFindingRangeInDiff(
  diff: string,
  file: string,
  line: number,
  startLine?: number | null,
): boolean {
  const start = startLine != null && startLine < line ? startLine : null
  return start !== null
    ? isLineRangeInDiff(diff, file, start, line)
    : isLineInDiff(diff, file, line)
}
