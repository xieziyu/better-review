// Annotates a unified diff so each body line carries its new-file line number
// in a fixed-width gutter, e.g.:
//
//   @@ -6,7 +6,11 @@ const EnvShape = z.object({
//     6 |    RECORD_REQUEST_BODY: z.coerce.boolean().default(false),
//     7 |    MONGO_PODHUB_URL: z.string(),
//     8 |    MONGO_PODHUB_DATA_URL: z.string(),
//     9 | +  GLOBAL_EPISODE_RECOMMEND_TASK_LOOKBACK_HOURS: z.number().default(2),
//    10 |    SENTRY_OMNI_DSN: z.string().optional(),
//
// Removed lines ('-') get a blank gutter since they don't exist in the new
// file. File headers (`diff --git`, `index`, `---`, `+++`) and hunk headers
// (`@@`) pass through unchanged so the diff structure stays parseable.
//
// The agent uses the gutter as the canonical source of `line` / `startLine`
// values for findings, removing the need to count offsets from `@@` headers.

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

function gutter(n: number | null, width: number): string {
  const cell = n === null ? '' : String(n)
  return cell.padStart(width, ' ') + ' | '
}

function gutterWidth(diff: string): number {
  let max = 0
  for (const line of diff.split('\n')) {
    const m = HUNK_RE.exec(line)
    if (!m) continue
    const start = Number(m[1])
    const lengthMatch = /\+\d+(?:,(\d+))?/.exec(line)
    const length = lengthMatch && lengthMatch[1] ? Number(lengthMatch[1]) : 1
    const end = start + Math.max(length, 1) - 1
    if (end > max) max = end
  }
  return Math.max(2, String(max).length)
}

export function annotateDiffWithLineNumbers(diff: string): string {
  const width = gutterWidth(diff)
  const blank = gutter(null, width)
  const out: string[] = []
  let inFile = false
  let nextNew: number | null = null

  for (const line of diff.split('\n')) {
    if (
      line.startsWith('diff --git ') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ') ||
      line.startsWith('new file ') ||
      line.startsWith('deleted file ') ||
      line.startsWith('Binary ') ||
      line.startsWith('\\ ')
    ) {
      if (line.startsWith('diff --git ')) inFile = true
      out.push(line)
      continue
    }
    const hunk = HUNK_RE.exec(line)
    if (hunk) {
      nextNew = Number(hunk[1])
      out.push(line)
      continue
    }
    if (!inFile || nextNew === null) {
      out.push(line)
      continue
    }
    const prefix = line.charAt(0)
    if (prefix === '+' || prefix === ' ') {
      out.push(gutter(nextNew, width) + line)
      nextNew += 1
    } else if (prefix === '-') {
      out.push(blank + line)
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}
