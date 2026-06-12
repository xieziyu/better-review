import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  parseDiff,
  Diff,
  findChangeByNewLineNumber,
  getChangeKey,
  type HunkData,
  type FileData,
  type HunkTokens,
  type RenderToken,
} from 'react-diff-view'

import { inferLangFromFile } from '@/lib/lang-from-file'
import { getHighlighter } from '@/lib/shiki'
import { shikiTokensForDiff, type ShikiDiffTokenNode } from '@/lib/shiki-diff-tokens'
import { useFileExpansion } from '@/lib/use-file-expansion'

import { renderHunksWithExpanders } from './files-changed/DiffExpander'

import 'react-diff-view/style/index.css'
import './DiffViewer.css'

interface Props {
  /** Session whose source tree backs the hidden-line expanders. */
  sessionId: string
  unifiedDiff: string | null
  file: string
  line: number | null
  findingId: string
}

/** Project a Shiki-tagged token onto a span carrying both theme colors as CSS
 *  variables; `.shiki-tok` rules in DiffViewer.css pick the active one. */
const renderShikiToken: RenderToken = (token, renderDefault, i) => {
  if ((token as { type?: string }).type === 'shiki') {
    const shiki = token as ShikiDiffTokenNode
    const style = {
      '--shiki-light': shiki.light,
      '--shiki-dark': shiki.dark,
    } as CSSProperties
    return (
      <span key={i} className="shiki-tok" style={style}>
        {shiki.value}
      </span>
    )
  }
  return renderDefault(token, i)
}

function fileMatches(f: FileData, target: string): boolean {
  return (f.newPath ?? '') === target || (f.oldPath ?? '') === target
}

function findContainingHunk(hunks: HunkData[], anchor: number): HunkData | undefined {
  return hunks.find((h) => anchor >= h.newStart && anchor < h.newStart + h.newLines)
}

export function DiffViewer({ sessionId, unifiedDiff, file, line, findingId }: Props) {
  const fileDiff = useMemo<FileData | undefined>(() => {
    if (!unifiedDiff) return undefined
    try {
      const files = parseDiff(unifiedDiff)
      return files.find((f) => fileMatches(f, file))
    } catch {
      return undefined
    }
  }, [unifiedDiff, file])

  const anchor = line ?? 0
  const containingHunk = useMemo(
    () => (fileDiff ? findContainingHunk(fileDiff.hunks, anchor) : undefined),
    [fileDiff, anchor],
  )

  // Show the file's diff hunks; the gap expanders pull real file context on
  // demand (between hunks and at the head/tail). When the finding's line sits
  // outside every hunk we auto-expand the surrounding gap so it comes into
  // view — the case the old "Expand full file" toggle could never reach.
  const baseHunks = useMemo<HunkData[]>(() => fileDiff?.hunks ?? [], [fileDiff])

  const { hunks, totalLines, status, expand, expandGapContaining } = useFileExpansion(
    sessionId,
    file,
    baseHunks,
  )
  const expandable = status !== 'unavailable'

  // Off-diff finding: pull in the surrounding context so the line is visible.
  useEffect(() => {
    if (line != null && fileDiff && !containingHunk) {
      expandGapContaining(line)
    }
  }, [line, fileDiff, containingHunk, expandGapContaining])

  const selectedChanges = useMemo<string[]>(() => {
    if (line == null || hunks.length === 0) return []
    const change = findChangeByNewLineNumber(hunks, line)
    return change ? [getChangeKey(change)] : []
  }, [hunks, line])

  // Shiki-driven syntax highlighting for the visible hunks. We tokenize only
  // the rendered hunks (not the whole file), so tokens may miss multi-line
  // context (e.g. an open block comment beyond a hunk) — visually fine for the
  // short slices we render.
  const [tokens, setTokens] = useState<HunkTokens | null>(null)
  const lang = useMemo(() => inferLangFromFile(file), [file])

  useEffect(() => {
    let cancelled = false
    // Drop the previous tokens immediately. react-diff-view's CodeCell uses
    // each token's *value* in place of change.content, so a stale tokens map
    // would print the previous finding's source on the current finding's
    // line numbers until the new tokenization lands.
    setTokens(null)
    if (!fileDiff || hunks.length === 0 || lang === 'plaintext') {
      return
    }
    void (async () => {
      try {
        const highlighter = await getHighlighter()
        if (cancelled) return
        const next = await shikiTokensForDiff(highlighter, lang, hunks)
        if (!cancelled) setTokens(next)
      } catch {
        // Highlighter failed — keep tokens cleared so react-diff-view falls
        // back to its plain-text rendering of the current diff.
        if (!cancelled) setTokens(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fileDiff, hunks, lang])

  if (!unifiedDiff) {
    return (
      <div
        role="region"
        aria-label={`Code context for finding ${findingId}`}
        className="border-t border-rule px-3 py-2 text-meta text-ink-muted italic"
      >
        Loading diff…
      </div>
    )
  }

  if (!fileDiff) {
    return (
      <div
        role="region"
        aria-label={`Code context for finding ${findingId}`}
        className="border-t border-rule px-3 py-2 text-meta text-ink-muted"
      >
        File not in diff: <span className="font-mono text-ink-secondary">{file}</span>
      </div>
    )
  }

  return (
    <div
      role="region"
      aria-label={`Code context for finding ${findingId}`}
      className="border border-rule rounded-md overflow-hidden bg-sunken"
    >
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-rule">
        <span className="font-mono text-meta text-ink-secondary tabular-nums">
          {file}
          {line ? `:${line}` : ''}
        </span>
      </header>
      {hunks.length === 0 ? (
        <div className="px-3 py-2 text-meta text-ink-muted">No diff context near line {line}.</div>
      ) : (
        <Diff
          viewType="unified"
          diffType={fileDiff.type}
          hunks={hunks}
          selectedChanges={selectedChanges}
          tokens={tokens}
          renderToken={renderShikiToken}
        >
          {(hs: HunkData[]) =>
            renderHunksWithExpanders(hs, { expandable, totalLines, onExpand: expand })
          }
        </Diff>
      )}
    </div>
  )
}
