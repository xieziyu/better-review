import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Diff,
  type ChangeData,
  type HunkData,
  type HunkTokens,
  type RenderGutter,
  type RenderToken,
} from 'react-diff-view'

import { inferLangFromFile } from '@/lib/lang-from-file'
import { getHighlighter } from '@/lib/shiki'
import { shikiTokensForDiff, type ShikiDiffTokenNode } from '@/lib/shiki-diff-tokens'

import { renderHunksWithExpanders } from './DiffExpander'

import 'react-diff-view/style/index.css'
import '../DiffViewer.css'
import './FileDiff.css'

interface Props {
  file: string
  fileType: 'add' | 'delete' | 'modify' | 'rename' | 'copy'
  hunks: HunkData[]
  /** Map of react-diff-view changeKey → rendered widget (e.g. inline finding card). */
  widgets?: Record<string, ReactNode>
  /** Called when the user clicks the gutter + on an inserted/context new-side row. */
  onAddRequest?: (newLineNumber: number, opts: { extend: boolean }) => void
  /** Tooltip shown on the gutter + button (also used as aria-label suffix). */
  addRequestTitle?: string
  /** Highlight a specific change (e.g. when an inline finding is expanded). */
  selectedChanges?: string[]
  /** Layout: side-by-side `split` or stacked `unified` (default). */
  viewType?: 'unified' | 'split'
  /** Render GitHub-style expanders in the gaps between hunks / at file edges. */
  expandable?: boolean
  /** Total NEW-side line count of the file; enables the bottom-of-file expander. */
  totalLines?: number | null
  /** Reveal NEW-side lines [newStart, newEnd) numbered from oldStart on the old side. */
  onExpand?: (newStart: number, newEnd: number, oldStart: number) => void
}

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

function changeNewLine(c: ChangeData): number | null {
  if (c.type === 'normal') return c.newLineNumber
  if (c.type === 'insert') return c.lineNumber
  return null
}

export function FileDiff({
  file,
  fileType,
  hunks,
  widgets,
  onAddRequest,
  addRequestTitle,
  selectedChanges,
  viewType = 'unified',
  expandable,
  totalLines,
  onExpand,
}: Props) {
  const [tokens, setTokens] = useState<HunkTokens | null>(null)
  const lang = useMemo(() => inferLangFromFile(file), [file])

  useEffect(() => {
    let cancelled = false
    setTokens(null)
    if (hunks.length === 0 || lang === 'plaintext') return
    void (async () => {
      try {
        const highlighter = await getHighlighter()
        if (cancelled) return
        const next = await shikiTokensForDiff(highlighter, lang, hunks)
        if (!cancelled) setTokens(next)
      } catch {
        if (!cancelled) setTokens(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, hunks, lang])

  const renderGutter: RenderGutter = ({ change, side, renderDefault }) => {
    const newLine = side === 'new' ? changeNewLine(change) : null
    if (!onAddRequest || newLine == null) {
      return renderDefault()
    }
    const label = `Add finding at line ${newLine}`
    return (
      <span className="file-diff-gutter-cell">
        {renderDefault()}
        <button
          type="button"
          className="file-diff-add"
          aria-label={addRequestTitle ? `${label} — ${addRequestTitle}` : label}
          title={addRequestTitle ?? label}
          onClick={(e) => onAddRequest(newLine, { extend: e.shiftKey })}
        >
          +
        </button>
      </span>
    )
  }

  if (hunks.length === 0) {
    return <div className="px-4 py-6 text-meta text-ink-muted">No changes to render.</div>
  }

  return (
    <Diff
      viewType={viewType}
      diffType={fileType}
      hunks={hunks}
      widgets={widgets ?? {}}
      selectedChanges={selectedChanges ?? []}
      tokens={tokens}
      renderToken={renderShikiToken}
      renderGutter={renderGutter}
    >
      {(hs: HunkData[]) =>
        renderHunksWithExpanders(hs, {
          expandable: Boolean(expandable && onExpand),
          totalLines: totalLines ?? null,
          onExpand: onExpand ?? (() => {}),
        })
      }
    </Diff>
  )
}
