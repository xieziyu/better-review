import { describe, expect, it } from 'vitest'

import { findNewSideChange, isLineOnNewSide, parseFileList } from '@/lib/diff-utils'

const DIFF = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const a = 1
+const b = 2
 const c = 3
 const d = 4
diff --git a/src/added.ts b/src/added.ts
new file mode 100644
--- /dev/null
+++ b/src/added.ts
@@ -0,0 +1,2 @@
+export const NEW = true
+export const OTHER = false
diff --git a/src/removed.ts b/src/removed.ts
deleted file mode 100644
--- a/src/removed.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const gone = 1
-const erased = 2
`

describe('parseFileList', () => {
  it('returns one summary per file with correct status and counts', () => {
    const list = parseFileList(DIFF)
    expect(list).toHaveLength(3)
    const foo = list.find((f) => f.path === 'src/foo.ts')!
    expect(foo.status).toBe('modify')
    expect(foo.additions).toBe(1)
    expect(foo.deletions).toBe(0)

    const added = list.find((f) => f.path === 'src/added.ts')!
    expect(added.status).toBe('add')
    expect(added.additions).toBe(2)
    expect(added.deletions).toBe(0)

    const removed = list.find((f) => f.path === 'src/removed.ts')!
    expect(removed.status).toBe('delete')
    expect(removed.additions).toBe(0)
    expect(removed.deletions).toBe(2)
  })

  it('returns empty for empty diff', () => {
    expect(parseFileList('')).toEqual([])
  })
})

describe('findNewSideChange / isLineOnNewSide', () => {
  it('matches inserted lines on the new side', () => {
    const foo = parseFileList(DIFF).find((f) => f.path === 'src/foo.ts')!
    expect(isLineOnNewSide(foo.hunks, 2)).toBe(true)
    const change = findNewSideChange(foo.hunks, 2)
    expect(change?.type).toBe('insert')
  })

  it('matches context lines visible in the new-side rendering', () => {
    const foo = parseFileList(DIFF).find((f) => f.path === 'src/foo.ts')!
    expect(isLineOnNewSide(foo.hunks, 1)).toBe(true)
    expect(findNewSideChange(foo.hunks, 1)?.type).toBe('normal')
  })

  it('rejects lines outside any hunk', () => {
    const foo = parseFileList(DIFF).find((f) => f.path === 'src/foo.ts')!
    expect(isLineOnNewSide(foo.hunks, 999)).toBe(false)
  })

  it('rejects new-side lookups on deleted files', () => {
    const removed = parseFileList(DIFF).find((f) => f.path === 'src/removed.ts')!
    // Deleted files have no new-side lines.
    expect(isLineOnNewSide(removed.hunks, 1)).toBe(false)
  })
})
