import { describe, it, expect } from 'vitest'

import { isLineInDiff } from '../../../src/server/engine/diff-line-validator'

const SAMPLE = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -10,3 +10,5 @@
 ctx
 ctx
+new1
+new2
 ctx
diff --git a/bar.ts b/bar.ts
--- a/bar.ts
+++ b/bar.ts
@@ -1,2 +1,3 @@
+only-add
 a
 b
`

describe('isLineInDiff', () => {
  it('matches added/changed lines on RIGHT side', () => {
    expect(isLineInDiff(SAMPLE, 'foo.ts', 10)).toBe(true)
    expect(isLineInDiff(SAMPLE, 'foo.ts', 12)).toBe(true)
    expect(isLineInDiff(SAMPLE, 'foo.ts', 14)).toBe(true)
    expect(isLineInDiff(SAMPLE, 'bar.ts', 1)).toBe(true)
    expect(isLineInDiff(SAMPLE, 'bar.ts', 3)).toBe(true)
  })
  it('rejects line outside any hunk', () => {
    expect(isLineInDiff(SAMPLE, 'foo.ts', 99)).toBe(false)
    expect(isLineInDiff(SAMPLE, 'foo.ts', 9)).toBe(false)
    expect(isLineInDiff(SAMPLE, 'other.ts', 1)).toBe(false)
  })
})
