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
        map.get(curFile)!.ranges.push({ start, length })
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
