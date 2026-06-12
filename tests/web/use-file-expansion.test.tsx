import { renderHook, waitFor } from '@testing-library/react'
import { findChangeByNewLineNumber, parseDiff, type HunkData } from 'react-diff-view'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { useFileExpansion } from '@/lib/use-file-expansion'

const getSessionFile = vi.fn()
vi.mock('@/lib/api', () => ({ api: { getSessionFile: (...a: unknown[]) => getSessionFile(...a) } }))

// A diff that inserts two lines in the first hunk, so old/new line numbers
// diverge by 2 in the gap that follows. This is exactly the case where naively
// indexing head content by OLD line numbers would surface the wrong text.
const DIFF = `diff --git a/f.ts b/f.ts
index 1..2 100644
--- a/f.ts
+++ b/f.ts
@@ -1,2 +1,4 @@
 old1
+ins1
+ins2
 old2
@@ -7,2 +9,2 @@
 old7
-old8
+new8
`

// The head (NEW) file content — what GET /api/sessions/:id/file returns.
const HEAD = [
  'old1',
  'ins1',
  'ins2',
  'old2',
  'old3',
  'old4',
  'old5',
  'old6',
  'old7',
  'new8',
  'old9',
  'old10',
].join('\n')

function baseHunks(): HunkData[] {
  const [file] = parseDiff(DIFF)
  return file!.hunks
}

describe('useFileExpansion', () => {
  beforeEach(() => {
    getSessionFile.mockReset()
  })

  it('reveals gap context with correct NEW-side content despite an old/new offset', async () => {
    getSessionFile.mockResolvedValue(HEAD)
    const hunks = baseHunks()
    const { result } = renderHook(() => useFileExpansion('s1', 'f.ts', hunks))

    // Gap between hunk0 (new ends at 4) and hunk1 (new starts at 9): reveal new
    // lines 5..8, numbering the old side from old line 3.
    result.current.expand(5, 9, 3)

    await waitFor(() => {
      const c = findChangeByNewLineNumber(result.current.hunks, 6)
      expect(c).toBeTruthy()
    })

    // new line 5 == old3 (two lines were inserted above, shifting content down).
    expect(findChangeByNewLineNumber(result.current.hunks, 5)?.content).toBe('old3')
    expect(findChangeByNewLineNumber(result.current.hunks, 6)?.content).toBe('old4')
    expect(findChangeByNewLineNumber(result.current.hunks, 8)?.content).toBe('old6')
    expect(result.current.totalLines).toBe(12)
  })

  it('expandGapContaining reveals the gap holding an off-diff line', async () => {
    getSessionFile.mockResolvedValue(HEAD)
    const hunks = baseHunks()
    const { result } = renderHook(() => useFileExpansion('s1', 'f.ts', hunks))

    // Line 7 (new) is unchanged context between the two hunks — off-diff.
    result.current.expandGapContaining(7)

    await waitFor(() => {
      expect(findChangeByNewLineNumber(result.current.hunks, 7)?.content).toBe('old5')
    })
  })

  it('marks the source unavailable when the file cannot be fetched', async () => {
    getSessionFile.mockResolvedValue(null)
    const hunks = baseHunks()
    const { result } = renderHook(() => useFileExpansion('s1', 'gone.ts', hunks))

    result.current.expand(5, 9, 3)

    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    // Hunks stay untouched when there is no source to expand from.
    expect(findChangeByNewLineNumber(result.current.hunks, 6)).toBeFalsy()
  })
})
