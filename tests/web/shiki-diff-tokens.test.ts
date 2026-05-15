import type { HunkData } from 'react-diff-view'
import { describe, expect, it } from 'vitest'

import { shikiTokensForDiff, type ShikiDiffTokenNode } from '@/lib/shiki-diff-tokens'
import type { Highlighter } from '@/lib/shiki'

// A minimal Highlighter stub. Real Shiki ships WASM that fails under jsdom,
// so we drive the adapter with a deterministic fake: every line tokenizes to a
// single content-bearing token whose colors echo the input — easy to assert.
function fakeHighlighter(loaded: string[] = ['typescript']): Highlighter {
  const hi = {
    getLoadedLanguages: () => loaded,
    loadLanguage: async () => {},
    // Mirror real shiki behavior: variants are keyed by the user-chosen
    // option names ('light' / 'dark'), not the theme ids.
    codeToTokensWithThemes: (code: string) =>
      code.split('\n').map((line) => [
        {
          content: line,
          variants: {
            light: { color: '#24292e' },
            dark: { color: '#e1e4e8' },
          },
        },
      ]),
  }
  return hi as unknown as Highlighter
}

function normal(content: string, oldLineNumber: number, newLineNumber: number): HunkData['changes'][number] {
  return { type: 'normal', content, oldLineNumber, newLineNumber, isNormal: true } as never
}
function ins(content: string, lineNumber: number): HunkData['changes'][number] {
  return { type: 'insert', content, lineNumber, isInsert: true } as never
}
function del(content: string, lineNumber: number): HunkData['changes'][number] {
  return { type: 'delete', content, lineNumber, isDelete: true } as never
}

function makeHunk(changes: HunkData['changes']): HunkData {
  return {
    content: '',
    oldStart: 1,
    newStart: 1,
    oldLines: changes.filter((c) => c.type !== 'insert').length,
    newLines: changes.filter((c) => c.type !== 'delete').length,
    changes,
  }
}

describe('shikiTokensForDiff', () => {
  it('returns null for plaintext language', async () => {
    const tokens = await shikiTokensForDiff(fakeHighlighter(), 'plaintext', [makeHunk([])])
    expect(tokens).toBeNull()
  })

  it('produces per-line tokens indexed by line number, on both sides', async () => {
    // old: line 40 "context A", line 41 "context B", line 42 "removed line"
    // new: line 40 "context A", line 41 "context B", line 42 "added line"
    const hunk = makeHunk([
      normal('context A', 40, 40),
      normal('context B', 41, 41),
      del('removed line', 42),
      ins('added line', 42),
    ])
    const out = await shikiTokensForDiff(fakeHighlighter(), 'typescript', [hunk])
    expect(out).not.toBeNull()
    expect(out!.old).toHaveLength(42)
    expect(out!.new).toHaveLength(42)
    // line numbers are 1-based; arrays are 0-indexed
    expect((out!.old[39]![0] as ShikiDiffTokenNode).value).toBe('context A')
    expect((out!.old[40]![0] as ShikiDiffTokenNode).value).toBe('context B')
    expect((out!.old[41]![0] as ShikiDiffTokenNode).value).toBe('removed line')
    expect((out!.new[41]![0] as ShikiDiffTokenNode).value).toBe('added line')
  })

  it('annotates each token with light and dark colors from variants', async () => {
    const hunk = makeHunk([normal('x', 1, 1)])
    const out = await shikiTokensForDiff(fakeHighlighter(), 'typescript', [hunk])
    const tok = out!.new[0]![0] as ShikiDiffTokenNode
    expect(tok.type).toBe('shiki')
    expect(tok.light).toBe('#24292e')
    expect(tok.dark).toBe('#e1e4e8')
    // Regression: we previously read variants by theme id ('github-light'),
    // which silently returns undefined and falls back to 'inherit'. Reading
    // by the *option key* ('light' / 'dark') is what produces actual colors.
    expect(tok.light).not.toBe('inherit')
    expect(tok.dark).not.toBe('inherit')
  })

  it('fills gap lines with empty tokens so indexing stays stable', async () => {
    // Skip from line 1 to line 5 — lines 2/3/4 should still resolve to empty token rows.
    const hunk = makeHunk([normal('a', 1, 1), normal('b', 5, 5)])
    const out = await shikiTokensForDiff(fakeHighlighter(), 'typescript', [hunk])
    expect(out!.old).toHaveLength(5)
    expect((out!.old[2]![0] as ShikiDiffTokenNode).value).toBe('')
  })
})
