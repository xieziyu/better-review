import type { HunkData } from 'react-diff-view'
import type { HunkTokens, TokenNode } from 'react-diff-view'

import type { ShikiLang } from '@/lib/lang-from-file'
import { ensureLang, type Highlighter, THEMES } from '@/lib/shiki'

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

/**
 * Reconstruct an old/new line array from a hunk set. Indices are 0-based and
 * align with each change's `oldLineNumber` / `newLineNumber` minus one, so
 * react-diff-view's per-line lookup picks the right token row.
 *
 * Lines outside any change are filled with empty strings; this keeps the
 * resulting joined text dense and the indexing stable.
 */
function reconstructPair(hunks: HunkData[]): readonly [string, string] {
  const oldLines: string[] = []
  const newLines: string[] = []

  for (const hunk of hunks) {
    for (const c of hunk.changes) {
      if (c.type === 'normal') {
        oldLines[c.oldLineNumber - 1] = c.content
        newLines[c.newLineNumber - 1] = c.content
      } else if (c.type === 'delete') {
        oldLines[c.lineNumber - 1] = c.content
      } else {
        // insert
        newLines[c.lineNumber - 1] = c.content
      }
    }
  }

  // Densify sparse arrays so .join('\n') produces stable indexing.
  for (let i = 0; i < oldLines.length; i++) oldLines[i] ??= ''
  for (let i = 0; i < newLines.length; i++) newLines[i] ??= ''

  return [oldLines.join('\n'), newLines.join('\n')] as const
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

  const [oldText, newText] = reconstructPair(hunks)

  try {
    const themes = { light: THEMES[0], dark: THEMES[1] } as const
    const oldTokens = highlighter.codeToTokensWithThemes(oldText, { lang: resolved, themes })
    const newTokens = highlighter.codeToTokensWithThemes(newText, { lang: resolved, themes })

    return {
      old: oldTokens.map(toTokenNodes),
      new: newTokens.map(toTokenNodes),
    }
  } catch {
    return null
  }
}
