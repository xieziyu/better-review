import { describe, it, expect } from 'vitest'

import {
  BUILTIN_REVIEW_EXCLUDE_GLOBS,
  chooseDiffForAgent,
  filterDiffByGlobs,
  resolveExcludeGlobs,
} from '../../../src/server/engine/diff-filter'

// Build one per-file diff section. Every block ends with a trailing newline so
// concatenations mimic real `gh pr diff` output.
function modifyBlock(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,3 +1,3 @@',
    ' context',
    '-old line',
    '+new line',
    '',
  ].join('\n')
}

function deleteBlock(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    'deleted file mode 100644',
    'index 4444444..0000000',
    `--- a/${path}`,
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-gone a',
    '-gone b',
    '',
  ].join('\n')
}

// A modify block whose `diff --git` / `---` / `+++` headers are supplied
// verbatim — used to exercise Git's C-quoted (non-ASCII) header form.
function modifyBlockWithHeaders(gitLine: string, minus: string, plus: string): string {
  return [
    gitLine,
    'index 1111111..2222222 100644',
    minus,
    plus,
    '@@ -1,3 +1,3 @@',
    ' context',
    '-old line',
    '+new line',
    '',
  ].join('\n')
}

function renameBlock(from: string, to: string): string {
  return [
    `diff --git a/${from} b/${to}`,
    'similarity index 100%',
    `rename from ${from}`,
    `rename to ${to}`,
    '',
  ].join('\n')
}

const ALL = resolveExcludeGlobs([])

describe('resolveExcludeGlobs', () => {
  it('returns the built-in defaults when given no user globs', () => {
    expect(resolveExcludeGlobs([])).toEqual([...BUILTIN_REVIEW_EXCLUDE_GLOBS])
  })

  it('appends user globs after the built-ins', () => {
    const out = resolveExcludeGlobs(['*.generated.ts'])
    expect(out).toContain('pnpm-lock.yaml')
    expect(out).toContain('*.generated.ts')
    expect(out.at(-1)).toBe('*.generated.ts')
  })

  it('trims entries and drops blank lines and # comments', () => {
    const out = resolveExcludeGlobs(['', '   ', '# a comment', '  *.bar  '])
    expect(out).toContain('*.bar')
    expect(out).not.toContain('# a comment')
    expect(out.filter((g) => g === '')).toHaveLength(0)
  })

  it('dedupes a user glob that duplicates a built-in', () => {
    const out = resolveExcludeGlobs(['pnpm-lock.yaml'])
    expect(out).toEqual([...BUILTIN_REVIEW_EXCLUDE_GLOBS])
  })
})

describe('filterDiffByGlobs', () => {
  it('passes an empty diff through unchanged', () => {
    expect(filterDiffByGlobs('', ALL)).toEqual({
      filteredDiff: '',
      excludedFiles: [],
      keptFiles: [],
    })
  })

  it('passes a diff with no `diff --git` section through unchanged', () => {
    const raw = 'just some text\nwith no header\n'
    expect(filterDiffByGlobs(raw, ALL).filteredDiff).toBe(raw)
  })

  it('is byte-for-byte identical when nothing matches', () => {
    const raw = modifyBlock('src/foo.ts') + modifyBlock('src/bar.ts')
    const out = filterDiffByGlobs(raw, ALL)
    expect(out.filteredDiff).toBe(raw)
    expect(out.excludedFiles).toEqual([])
    expect(out.keptFiles).toEqual(['src/foo.ts', 'src/bar.ts'])
  })

  it('drops a top-level lockfile block', () => {
    const raw = modifyBlock('pnpm-lock.yaml')
    const out = filterDiffByGlobs(raw, ALL)
    expect(out.filteredDiff).toBe('')
    expect(out.excludedFiles).toEqual(['pnpm-lock.yaml'])
    expect(out.keptFiles).toEqual([])
  })

  it('drops a nested lockfile matched by the bare basename pattern', () => {
    const raw = modifyBlock('apps/web/pnpm-lock.yaml')
    const out = filterDiffByGlobs(raw, ALL)
    expect(out.excludedFiles).toEqual(['apps/web/pnpm-lock.yaml'])
    expect(out.filteredDiff).toBe('')
  })

  it('matches `*.min.js` at the repo root and when nested', () => {
    const raw = modifyBlock('app.min.js') + modifyBlock('public/vendor/lib.min.js')
    const out = filterDiffByGlobs(raw, ALL)
    expect(out.excludedFiles).toEqual(['app.min.js', 'public/vendor/lib.min.js'])
    expect(out.filteredDiff).toBe('')
  })

  it('matches a nested build dir but not a same-prefix sibling', () => {
    const kept = modifyBlock('distfoo/keep.ts')
    const raw = modifyBlock('packages/ui/dist/bundle.js') + kept
    const out = filterDiffByGlobs(raw, ALL)
    expect(out.excludedFiles).toEqual(['packages/ui/dist/bundle.js'])
    expect(out.keptFiles).toEqual(['distfoo/keep.ts'])
    expect(out.filteredDiff).toBe(kept)
  })

  it('keeps source blocks byte-for-byte while dropping the lockfile in between', () => {
    const a = modifyBlock('src/a.ts')
    const b = modifyBlock('src/b.ts')
    const raw = a + modifyBlock('pnpm-lock.yaml') + b
    const out = filterDiffByGlobs(raw, ALL)
    expect(out.filteredDiff).toBe(a + b)
    expect(out.excludedFiles).toEqual(['pnpm-lock.yaml'])
    expect(out.keptFiles).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('preserves any preamble before the first `diff --git` line', () => {
    const preamble = 'leading note\n'
    const raw = preamble + modifyBlock('pnpm-lock.yaml') + modifyBlock('src/keep.ts')
    const out = filterDiffByGlobs(raw, ALL)
    expect(out.filteredDiff).toBe(preamble + modifyBlock('src/keep.ts'))
  })

  it('resolves a pure-deletion path from the `--- a/` header', () => {
    const raw = deleteBlock('yarn.lock')
    const out = filterDiffByGlobs(raw, ALL)
    expect(out.excludedFiles).toEqual(['yarn.lock'])
    expect(out.filteredDiff).toBe('')
  })

  it('resolves a rename-only block path from the `rename to` line', () => {
    const raw = renameBlock('src/old.ts', 'src/new.generated.ts')
    const out = filterDiffByGlobs(raw, resolveExcludeGlobs(['*.generated.ts']))
    expect(out.excludedFiles).toEqual(['src/new.generated.ts'])
    expect(out.filteredDiff).toBe('')
  })

  it('treats a leading `!` glob as literal, not picomatch negation', () => {
    // `reviewExcludeGlobs` is additive-only. A `!`-prefixed pattern must not
    // invert into "exclude everything else" — it should simply match nothing.
    const raw = modifyBlock('src/app.ts') + modifyBlock('src/util.ts')
    const out = filterDiffByGlobs(raw, resolveExcludeGlobs(['!src/generated/**']))
    expect(out.excludedFiles).toEqual([])
    expect(out.keptFiles).toEqual(['src/app.ts', 'src/util.ts'])
    expect(out.filteredDiff).toBe(raw)
  })

  it('honours a user-supplied glob on top of the built-ins', () => {
    const raw = modifyBlock('src/schema.generated.ts') + modifyBlock('src/keep.ts')
    const out = filterDiffByGlobs(raw, resolveExcludeGlobs(['*.generated.ts']))
    expect(out.excludedFiles).toEqual(['src/schema.generated.ts'])
    expect(out.keptFiles).toEqual(['src/keep.ts'])
  })

  it('strips Git C-quoted (non-ASCII) header quotes before matching', () => {
    // Git quotes paths with non-ASCII bytes — a lockfile under a Chinese dir
    // arrives as `+++ "b/\\345.../pnpm-lock.yaml"`. The basename rule must
    // still catch it.
    const qa = '"a/\\345\\272\\224\\347\\224\\250/pnpm-lock.yaml"'
    const qb = '"b/\\345\\272\\224\\347\\224\\250/pnpm-lock.yaml"'
    const raw = modifyBlockWithHeaders(`diff --git ${qa} ${qb}`, `--- ${qa}`, `+++ ${qb}`)
    const out = filterDiffByGlobs(raw, ALL)
    expect(out.excludedFiles).toEqual(['\\345\\272\\224\\347\\224\\250/pnpm-lock.yaml'])
    expect(out.filteredDiff).toBe('')
  })

  it('extracts a path containing spaces from the `+++` header', () => {
    const raw = modifyBlock('docs/my notes.snap')
    const out = filterDiffByGlobs(raw, ALL)
    expect(out.excludedFiles).toEqual(['docs/my notes.snap'])
    expect(out.filteredDiff).toBe('')
  })
})

describe('chooseDiffForAgent', () => {
  it('returns the filtered diff when at least one file is kept', () => {
    const raw = modifyBlock('src/keep.ts') + modifyBlock('pnpm-lock.yaml')
    const filtered = filterDiffByGlobs(raw, ALL)
    expect(chooseDiffForAgent(raw, filtered)).toBe(filtered.filteredDiff)
    expect(chooseDiffForAgent(raw, filtered)).toBe(modifyBlock('src/keep.ts'))
  })

  it('falls back to the raw diff when every file was excluded', () => {
    const raw = modifyBlock('pnpm-lock.yaml') + modifyBlock('yarn.lock')
    const filtered = filterDiffByGlobs(raw, ALL)
    expect(filtered.filteredDiff).toBe('')
    expect(chooseDiffForAgent(raw, filtered)).toBe(raw)
  })

  it('returns an empty diff unchanged (no spurious fallback)', () => {
    const filtered = filterDiffByGlobs('', ALL)
    expect(chooseDiffForAgent('', filtered)).toBe('')
  })
})
