// Drops per-file diff blocks whose path matches a skip-review glob, so the
// review agent's prompt does not spend tokens on lockfiles and other
// non-reviewable files. Applied to the prompt diff only — `diff.cache` keeps
// the raw full diff so the web "Files Changed" view and submit-time line
// validation are unaffected.

import picomatch from 'picomatch'

// Files that essentially never warrant code review. Each glob is matched
// against the full repo-relative path AND its basename, so a plain
// `pnpm-lock.yaml` pattern also catches a nested `apps/web/pnpm-lock.yaml`
// without needing a `**/` prefix.
export const BUILTIN_REVIEW_EXCLUDE_GLOBS: readonly string[] = [
  // dependency lockfiles
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'composer.lock',
  'Gemfile.lock',
  'Pipfile.lock',
  'flake.lock',
  // minified bundles + source maps
  '*.min.js',
  '*.min.css',
  '*.map',
  // test snapshots
  '*.snap',
  '**/__snapshots__/**',
  // common build / generated output directories
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/vendor/**',
  '**/.next/**',
  '**/coverage/**',
]

export interface DiffFilterResult {
  // The diff with excluded file blocks removed. Ready to feed the annotator.
  filteredDiff: string
  // Repo-relative paths of files whose blocks were dropped.
  excludedFiles: string[]
  // Repo-relative paths of files whose blocks were kept.
  keptFiles: string[]
}

/**
 * Build the effective skip list: built-in defaults extended by user globs.
 * Trims entries, drops blank lines and `#` comments (so the Settings textarea
 * can hold annotations), and dedupes while keeping first-seen order.
 */
export function resolveExcludeGlobs(userGlobs: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...BUILTIN_REVIEW_EXCLUDE_GLOBS, ...userGlobs]) {
    const g = raw.trim()
    if (!g || g.startsWith('#')) continue
    if (seen.has(g)) continue
    seen.add(g)
    out.push(g)
  }
  return out
}

// A unified diff is a concatenation of per-file sections, each starting with a
// `diff --git a/<path> b/<path>` line. The `m` flag lets `^` match after each
// newline so we can locate every section boundary.
const BLOCK_START_RE = /^diff --git .*$/gm

function blockStartOffsets(diff: string): number[] {
  const offsets: number[] = []
  BLOCK_START_RE.lastIndex = 0
  for (const m of diff.matchAll(BLOCK_START_RE)) offsets.push(m.index)
  return offsets
}

// `diff --git a/<old> b/<new>` — last-resort path source for binary / pure-
// rename blocks that carry no `+++`/`---` headers. Ambiguous for paths with
// spaces; the `+++`/`---`/`rename to` headers are preferred when present.
function pathFromGitLine(line: string): string | null {
  const rest = line.slice('diff --git '.length)
  const bIdx = rest.lastIndexOf(' b/')
  return bIdx >= 0 ? rest.slice(bIdx + 3) : null
}

// Resolve the repo-relative path a block describes. Prefers the `+++ b/<path>`
// header, falls back to `--- a/<path>` for pure deletions (where `+++` is
// `/dev/null`), then `rename to <path>`, then the `diff --git` line.
function pathForBlock(block: string): string | null {
  let plus: string | null = null
  let minus: string | null = null
  let renameTo: string | null = null
  let gitLine: string | null = null
  for (const line of block.split('\n')) {
    // Header lines all precede the first `@@` hunk; stop once the body starts
    // so a removed `---`/content line can't be mistaken for a header.
    if (line.startsWith('@@ ')) break
    if (line.startsWith('+++ ')) {
      const rest = line.slice(4).trim()
      if (rest !== '/dev/null') plus = rest.startsWith('b/') ? rest.slice(2) : rest
    } else if (line.startsWith('--- ')) {
      const rest = line.slice(4).trim()
      if (rest !== '/dev/null') minus = rest.startsWith('a/') ? rest.slice(2) : rest
    } else if (line.startsWith('rename to ')) {
      renameTo = line.slice('rename to '.length).trim()
    } else if (gitLine === null && line.startsWith('diff --git ')) {
      gitLine = line
    }
  }
  if (plus) return plus
  if (minus) return minus
  if (renameTo) return renameTo
  return gitLine ? pathFromGitLine(gitLine) : null
}

/**
 * Remove per-file blocks whose path matches any glob. The raw diff is never
 * mutated in place; a new string is returned and kept blocks are reproduced
 * byte-for-byte. Passes the diff through unchanged when it is empty or has no
 * `diff --git` section (e.g. a binary-only or otherwise atypical diff).
 */
export function filterDiffByGlobs(unifiedDiff: string, globs: readonly string[]): DiffFilterResult {
  const starts = blockStartOffsets(unifiedDiff)
  if (starts.length === 0) {
    return { filteredDiff: unifiedDiff, excludedFiles: [], keptFiles: [] }
  }
  const matchers = globs.map((g) => picomatch(g, { dot: true }))
  const isExcluded = (path: string): boolean => {
    const base = path.slice(path.lastIndexOf('/') + 1)
    return matchers.some((m) => m(path) || m(base))
  }

  const excludedFiles: string[] = []
  const keptFiles: string[] = []
  let out = unifiedDiff.slice(0, starts[0] ?? 0)
  for (const [i, start] of starts.entries()) {
    const block = unifiedDiff.slice(start, starts[i + 1] ?? unifiedDiff.length)
    const path = pathForBlock(block)
    if (path !== null && isExcluded(path)) {
      excludedFiles.push(path)
    } else {
      if (path !== null) keptFiles.push(path)
      out += block
    }
  }
  return { filteredDiff: out, excludedFiles, keptFiles }
}

/**
 * Pick the diff to hand the agent. Normally the filtered diff, but when every
 * file in the PR was excluded (the filtered diff has no `diff --git` section
 * left), fall back to the raw diff — feeding the agent an empty diff would
 * leave it nothing to review.
 */
export function chooseDiffForAgent(rawDiff: string, filtered: DiffFilterResult): string {
  if (filtered.excludedFiles.length > 0 && !/^diff --git /m.test(filtered.filteredDiff)) {
    return rawDiff
  }
  return filtered.filteredDiff
}
