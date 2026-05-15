import { useEffect, useState } from 'react'

import { inferLangFromFile } from '@/lib/lang-from-file'
import { ensureLang, getHighlighter, THEMES } from '@/lib/shiki'

interface Props {
  code: string
  /** Explicit language hint from a markdown fence (e.g. `ts`, `python`). */
  lang?: string | null | undefined
  /** Source file used to infer a language when `lang` is absent. */
  fallbackFile?: string | null | undefined
}

/**
 * Renders a code block with Shiki syntax highlighting. While the highlighter
 * resolves async, a plain `<pre><code>` fallback is shown so content remains
 * readable with zero layout shift.
 *
 * Dual-theme (`github-light` + `github-dark`) is emitted as CSS variables;
 * `.shiki-host` rules in `index.css` switch colors via `[data-theme='dark']`,
 * so theme toggles re-paint without re-highlighting.
 */
export function CodeBlock({ code, lang, fallbackFile }: Props) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Drop any previous render eagerly. Until the new highlight resolves we
    // want the plain <pre><code> fallback for the *current* code, not the
    // stale HTML from the previous (code, lang, fallbackFile) tuple.
    setHtml(null)
    void (async () => {
      const requested = lang && lang.trim().length > 0 ? lang : inferLangFromFile(fallbackFile)
      try {
        const highlighter = await getHighlighter()
        if (cancelled) return
        const resolved = await ensureLang(highlighter, requested)
        if (cancelled) return
        const out = highlighter.codeToHtml(code, {
          lang: resolved,
          themes: { light: THEMES[0], dark: THEMES[1] },
          defaultColor: false,
        })
        if (!cancelled) setHtml(out)
      } catch {
        // Highlighter failed — keep the fallback <pre><code> showing the
        // current code rather than risk leaving stale HTML on screen.
        if (!cancelled) setHtml(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code, lang, fallbackFile])

  if (html) {
    return (
      <div
        className="shiki-host bg-sunken border border-rule rounded-md overflow-x-auto"
        // Shiki output is generated locally from text we control; no untrusted HTML.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <pre className="font-mono text-code text-ink-primary bg-sunken border border-rule rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
      <code>{code}</code>
    </pre>
  )
}
