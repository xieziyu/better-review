import type { HunkData } from 'react-diff-view'
import type { HunkTokens, TokenNode } from 'react-diff-view'

import type { ShikiLang } from '@/lib/lang-from-file'
import { ensureLang, type Highlighter, type ResolvedLang, THEMES } from '@/lib/shiki'

/**
 * A `TokenNode` produced by `shikiTokensForDiff`. Carries both theme colors
 * inline; the matching `renderToken` in `DiffViewer.tsx` projects these onto
 * CSS variables (`--shiki-light` / `--shiki-dark`) so theme toggles repaint
 * without re-tokenizing.
 */
export interface ShikiDiffTokenNode extends TokenNode {
  type: 'shiki'
  value: string
  light: string
  dark: string
}

interface VisibleLine {
  /** Zero-based slot in the side's token array (= lineNumber − 1). */
  idx: number
  content: string
}

/**
 * Walk every change in the visible hunks and bucket it into the lines it
 * contributes to: `normal` → both sides, `insert` → new only, `delete` → old
 * only.
 *
 * We collect a compact `(idx, content)` list per side rather than padding a
 * sparse array up to the largest line number — that earlier shape made
 * tokenization cost O(absolute line number), which silently melted on
 * findings deep inside a large file.
 */
function collectVisibleLines(hunks: HunkData[]): readonly [VisibleLine[], VisibleLine[]] {
  const oldLines: VisibleLine[] = []
  const newLines: VisibleLine[] = []
  for (const hunk of hunks) {
    for (const c of hunk.changes) {
      if (c.type === 'normal') {
        oldLines.push({ idx: c.oldLineNumber - 1, content: c.content })
        newLines.push({ idx: c.newLineNumber - 1, content: c.content })
      } else if (c.type === 'delete') {
        oldLines.push({ idx: c.lineNumber - 1, content: c.content })
      } else {
        // insert
        newLines.push({ idx: c.lineNumber - 1, content: c.content })
      }
    }
  }
  return [oldLines, newLines] as const
}

interface ShikiVariantTokenStyle {
  color?: string
}

interface ShikiVariantToken {
  content: string
  variants: Record<string, ShikiVariantTokenStyle>
}

// Shiki's codeToTokensWithThemes keys `variants` by the user-chosen names from
// the `themes` option (here: 'light' / 'dark') — NOT by the underlying theme id
// like 'github-light'. Reading by theme id silently returns `undefined`, which
// is why this previously fell back to 'inherit' and produced no color.
function toTokenNodes(line: ShikiVariantToken[]): ShikiDiffTokenNode[] {
  return line.map((tok) => ({
    type: 'shiki',
    value: tok.content,
    light: tok.variants.light?.color ?? 'inherit',
    dark: tok.variants.dark?.color ?? 'inherit',
  }))
}

/**
 * Tokenize one side's visible lines as a single contiguous block, then scatter
 * each tokenized row back to its real 0-based line index in the result array.
 *
 * The result is intentionally sparse: gaps between visible lines stay as
 * `undefined` slots. react-diff-view's `CodeCell` already handles this — when
 * a line's token row is absent it falls back to rendering `change.content`,
 * so the contract with the library still holds.
 *
 * Note: cross-hunk grammar context is not preserved (we never see the lines
 * between hunks). Window-mode default renders a single hunk so this is moot;
 * full-file mode may have minor color artifacts at the boundary between two
 * widely-separated hunks. Acceptable for review windows.
 */
function tokenizeSide(
  highlighter: Highlighter,
  lang: ResolvedLang,
  lines: VisibleLine[],
): TokenNode[][] {
  const result: TokenNode[][] = []
  if (lines.length === 0) return result

  const text = lines.map((l) => l.content).join('\n')
  const themes = { light: THEMES[0], dark: THEMES[1] } as const
  const rows = highlighter.codeToTokensWithThemes(text, { lang, themes })

  lines.forEach((line, i) => {
    const row = rows[i]
    if (row) result[line.idx] = toTokenNodes(row as ShikiVariantToken[])
  })

  return result
}

/**
 * Produce per-line Shiki tokens for both sides of a unified diff. Returns
 * `null` when the language is unknown or tokenization fails — callers should
 * skip passing `tokens` in that case so react-diff-view falls back to plain
 * text rendering (its default).
 */
export async function shikiTokensForDiff(
  highlighter: Highlighter,
  lang: ShikiLang,
  hunks: HunkData[],
): Promise<HunkTokens | null> {
  if (lang === 'plaintext') return null
  const resolved = await ensureLang(highlighter, lang)
  if (resolved === 'plaintext') return null

  const [oldLines, newLines] = collectVisibleLines(hunks)

  try {
    return {
      old: tokenizeSide(highlighter, resolved, oldLines),
      new: tokenizeSide(highlighter, resolved, newLines),
    }
  } catch {
    return null
  }
}
