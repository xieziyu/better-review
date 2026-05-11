import { describe, it, expect } from 'vitest'

import { annotateDiffWithLineNumbers } from '../../../src/server/engine/diff-annotator'
import {
  annotateDiffWithIncremental,
  extractNewHunks,
} from '../../../src/server/engine/diff-incremental'
import type { GhCompare } from '../../../src/server/github/gh-client'

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,4 @@
 a
 b
+c
 d
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -10,2 +10,2 @@
-x
+y
 z
`

describe('extractNewHunks', () => {
  it('collects +N,M ranges across files', () => {
    const compare: GhCompare = {
      status: 'ahead',
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      files: [
        { filename: 'a.ts', status: 'modified', patch: '@@ -1,3 +1,4 @@\n a\n b\n+c\n d\n' },
        { filename: 'b.ts', status: 'modified', patch: '@@ -10,2 +10,2 @@\n-x\n+y\n z\n' },
      ],
    }
    expect(extractNewHunks(compare)).toEqual([
      { file: 'a.ts', newStart: 1, newEnd: 4 },
      { file: 'b.ts', newStart: 10, newEnd: 11 },
    ])
  })

  it('skips files without a patch (binary / too large)', () => {
    const compare: GhCompare = {
      status: 'ahead',
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      files: [{ filename: 'logo.png', status: 'modified' }],
    }
    expect(extractNewHunks(compare)).toEqual([])
  })
})

describe('annotateDiffWithIncremental', () => {
  it('is byte-identical to annotateDiffWithLineNumbers when no incremental info', () => {
    const baseline = annotateDiffWithLineNumbers(DIFF)
    expect(annotateDiffWithIncremental(DIFF, null, null)).toBe(baseline)
    expect(annotateDiffWithIncremental(DIFF, [], 'abc1234')).toBe(baseline)
    expect(
      annotateDiffWithIncremental(DIFF, [{ file: 'a.ts', newStart: 1, newEnd: 4 }], null),
    ).toBe(baseline)
  })

  it('marks hunks that overlap an incremental range', () => {
    const out = annotateDiffWithIncremental(
      DIFF,
      [{ file: 'a.ts', newStart: 1, newEnd: 4 }],
      'abc1234567',
    )
    // a.ts hunk gets the marker; b.ts hunk does not.
    expect(out).toContain('@@ -1,3 +1,4 @@ ← NEW since abc1234')
    expect(out).toContain('@@ -10,2 +10,2 @@')
    expect(out).not.toContain('@@ -10,2 +10,2 @@ ← NEW since')
  })

  it('does not cross file boundaries', () => {
    // Only b.ts is "new" — a.ts hunk should remain unmarked.
    const out = annotateDiffWithIncremental(
      DIFF,
      [{ file: 'b.ts', newStart: 10, newEnd: 11 }],
      'abc1234567',
    )
    expect(out).toContain('@@ -10,2 +10,2 @@ ← NEW since abc1234')
    expect(out).not.toContain('@@ -1,3 +1,4 @@ ← NEW since')
  })
})
