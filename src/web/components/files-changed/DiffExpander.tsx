import { ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { type ReactElement } from 'react'
import { Decoration, Hunk, getCollapsedLinesCountBetween, type HunkData } from 'react-diff-view'
import { useTranslation } from 'react-i18next'

// One screenful of context per directional click — matches GitHub's "expand
// 20 lines" affordance. Gaps at or under this size collapse to a single
// expand-everything button.
export const EXPAND_STEP = 20

export interface DiffExpanderProps {
  /** Half-open OLD-side range of the hidden gap: lines [gapStart, gapEnd). */
  gapStart: number
  gapEnd: number
  /** Expand a sub-range; `end` is exclusive. */
  onExpand: (start: number, end: number) => void
}

// A GitHub-style expander bar rendered between hunks (or at the file head /
// tail). For large gaps it splits into "reveal the lines just below the
// previous hunk" (down) and "reveal the lines just above the next hunk" (up);
// small gaps expand wholesale in one click.
export function DiffExpander({ gapStart, gapEnd, onExpand }: DiffExpanderProps) {
  const { t } = useTranslation()
  const count = gapEnd - gapStart
  if (count <= 0) return null

  const expandAll = () => onExpand(gapStart, gapEnd)
  const expandDown = () => onExpand(gapStart, Math.min(gapEnd, gapStart + EXPAND_STEP))
  const expandUp = () => onExpand(Math.max(gapStart, gapEnd - EXPAND_STEP), gapEnd)

  const big = count > EXPAND_STEP

  return (
    <Decoration>
      <div className="diff-expander">
        <div
          className={
            big ? 'diff-expander-actions' : 'diff-expander-actions diff-expander-actions-single'
          }
        >
          {big ? (
            <>
              <button
                type="button"
                className="diff-expander-btn"
                onClick={expandUp}
                title={t('filesChanged.expand.up')}
                aria-label={t('filesChanged.expand.up')}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="diff-expander-btn"
                onClick={expandDown}
                title={t('filesChanged.expand.down')}
                aria-label={t('filesChanged.expand.down')}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="diff-expander-btn"
              onClick={expandAll}
              title={t('filesChanged.expand.all')}
              aria-label={t('filesChanged.expand.all')}
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          className="diff-expander-label"
          onClick={big ? expandDown : expandAll}
          title={t('filesChanged.expand.label', { count })}
        >
          {t('filesChanged.expand.label', { count })}
          <span className="diff-expander-range">
            {gapStart}–{gapEnd - 1}
          </span>
        </button>
      </div>
    </Decoration>
  )
}

export interface InterleaveOptions {
  /** Whether expanders should be rendered at all (false hides them). */
  expandable: boolean
  /** Total OLD-side line count; enables the bottom-of-file expander. */
  totalLines: number | null
  /** Expand the half-open OLD-side range [start, end) into the hunks. */
  onExpand: (start: number, end: number) => void
}

// Render hunks with GitHub-style expander bars woven into the collapsed gaps
// between them and at the file head / tail. Shared by the Files Changed pane
// and the finding-detail context viewer so both behave identically. When
// `expandable` is false it degrades to a plain hunk list.
export function renderHunksWithExpanders(
  hunks: HunkData[],
  { expandable, totalLines, onExpand }: InterleaveOptions,
): ReactElement[] {
  if (!expandable) {
    return hunks.map((h) => <Hunk key={`${h.oldStart}-${h.newStart}`} hunk={h} />)
  }
  const out: ReactElement[] = []
  hunks.forEach((h, i) => {
    const prev = i === 0 ? null : (hunks[i - 1] ?? null)
    const collapsed = getCollapsedLinesCountBetween(prev, h)
    if (collapsed > 0) {
      const gapStart = prev ? prev.oldStart + prev.oldLines : 1
      out.push(
        <DiffExpander
          key={`exp-${h.oldStart}-${h.newStart}`}
          gapStart={gapStart}
          gapEnd={h.oldStart}
          onExpand={onExpand}
        />,
      )
    }
    out.push(<Hunk key={`${h.oldStart}-${h.newStart}`} hunk={h} />)
  })
  const last = hunks[hunks.length - 1]
  if (last && totalLines != null) {
    const tailStart = last.oldStart + last.oldLines
    if (totalLines >= tailStart) {
      out.push(
        <DiffExpander
          key="exp-tail"
          gapStart={tailStart}
          gapEnd={totalLines + 1}
          onExpand={onExpand}
        />,
      )
    }
  }
  return out
}
