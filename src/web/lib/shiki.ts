import type { BundledLanguage, Highlighter } from 'shiki/bundle/full'

/**
 * Languages preloaded with the highlighter on first init.
 * Keep this small — uncommon languages load on demand via `ensureLang`.
 * Picked to cover the most frequently seen review code blocks.
 */
const COMMON_LANGS: BundledLanguage[] = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'bash',
  'python',
  'markdown',
  'yaml',
  'diff',
]

const THEMES = ['github-light', 'github-dark'] as const

let highlighterPromise: Promise<Highlighter> | null = null

/**
 * Lazily create and cache the Shiki highlighter (one per page).
 * Subsequent callers reuse the same instance; the bundle is dynamic-imported
 * so Vite can code-split it out of the initial route chunk.
 */
export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki/bundle/full').then((m) =>
      m.createHighlighter({
        themes: [...THEMES],
        langs: COMMON_LANGS,
      }),
    )
  }
  return highlighterPromise
}

/**
 * Resolved language id usable as `lang` for `codeToHtml` /
 * `codeToTokensWithThemes`. After `ensureLang`, the value is always either a
 * loaded bundled grammar or the `'plaintext'` special language.
 */
export type ResolvedLang = BundledLanguage | 'plaintext'

/**
 * Ensure the given lang is loaded on the highlighter; on failure, fall back to
 * `'plaintext'`. Always returns a usable, loaded lang id so callers can pass
 * the result straight to `codeToHtml` / `codeToTokensWithThemes` without
 * further checks.
 */
export async function ensureLang(highlighter: Highlighter, lang: string): Promise<ResolvedLang> {
  if (lang === 'plaintext' || lang === 'text' || lang === 'plain') {
    return 'plaintext'
  }
  if (highlighter.getLoadedLanguages().includes(lang)) return lang as BundledLanguage
  try {
    await highlighter.loadLanguage(lang as BundledLanguage)
    return lang as BundledLanguage
  } catch {
    return 'plaintext'
  }
}

export { THEMES }
export type { BundledLanguage, Highlighter }
