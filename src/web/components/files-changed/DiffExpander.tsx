import { ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { type ReactElement } from 'react'
import { Decoration, Hunk, type HunkData } from 'react-diff-view'
import { useTranslation } from 'react-i18next'

// One screenful of context per directional click — matches GitHub's "expand
// 20 lines" affordance. Gaps at or under this size collapse to a single
// expand-everything button.
export const EXPAND_STEP = 20

export interface DiffExpanderProps {
  /** Half-open NEW-side range of the hidden gap: lines [gapNewStart, gapNewEnd). */
  gapNewStart: number
  gapNewEnd: number
  /** OLD-side line number corresponding to gapNewStart (the gap is unchanged). */
  gapOldStart: number
  /** Reveal NEW-side lines [newStart, newEnd) numbered from oldStart on the old side. */
  onExpand: (newStart: number, newEnd: number, oldStart: number) => void
}

// A GitHub-style expander bar rendered between hunks (or at the file head /
// tail). For large gaps it splits into "reveal the lines just below the
// previous hunk" (down) and "reveal the lines just above the next hunk" (up);
// small gaps expand wholesale in one click.
export function DiffExpander({ gapNewStart, gapNewEnd, gapOldStart, onExpand }: DiffExpanderProps) {
  const { t } = useTranslation()
  const count = gapNewEnd - gapNewStart
  if (count <= 0) return null

  // Within an unchanged gap old/new advance together, so a sub-range starting
  // at NEW line n maps to OLD line gapOldStart + (n - gapNewStart).
  const oldFor = (newStart: number) => gapOldStart + (newStart - gapNewStart)
  const expandAll = () => onExpand(gapNewStart, gapNewEnd, gapOldStart)
  const expandDown = () =>
    onExpand(gapNewStart, Math.min(gapNewEnd, gapNewStart + EXPAND_STEP), gapOldStart)
  const expandUp = () => {
    const newStart = Math.max(gapNewStart, gapNewEnd - EXPAND_STEP)
    onExpand(newStart, gapNewEnd, oldFor(newStart))
  }

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
            {gapNewStart}–{gapNewEnd - 1}
          </span>
        </button>
      </div>
    </Decoration>
  )
}

export interface InterleaveOptions {
  /** Whether expanders should be rendered at all (false hides them). */
  expandable: boolean
  /** Total NEW-side line count; enables the bottom-of-file expander. */
  totalLines: number | null
  /** Reveal NEW-side lines [newStart, newEnd) numbered from oldStart on the old side. */
  onExpand: (newStart: number, newEnd: number, oldStart: number) => void
}

// Render hunks with GitHub-style expander bars woven into the collapsed gaps
// between them and at the file head / tail. Shared by the Files Changed pane
// and the finding-detail context viewer so both behave identically. When
// `expandable` is false it degrades to a plain hunk list.
//
// Gaps are expressed in NEW-side coordinates (the file we fetch is the head
// version); each gap also carries the OLD-side line number at its start so the
// gutter numbering stays correct across earlier insertions/deletions.
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
    const gapNewStart = prev ? prev.newStart + prev.newLines : 1
    const gapNewEnd = h.newStart // exclusive
    if (gapNewEnd > gapNewStart) {
      const gapOldStart = prev ? prev.oldStart + prev.oldLines : 1
      out.push(
        <DiffExpander
          key={`exp-${h.oldStart}-${h.newStart}`}
          gapNewStart={gapNewStart}
          gapNewEnd={gapNewEnd}
          gapOldStart={gapOldStart}
          onExpand={onExpand}
        />,
      )
    }
    out.push(<Hunk key={`${h.oldStart}-${h.newStart}`} hunk={h} />)
  })
  const last = hunks[hunks.length - 1]
  if (last && totalLines != null) {
    const tailNewStart = last.newStart + last.newLines
    if (totalLines >= tailNewStart) {
      out.push(
        <DiffExpander
          key="exp-tail"
          gapNewStart={tailNewStart}
          gapNewEnd={totalLines + 1}
          gapOldStart={last.oldStart + last.oldLines}
          onExpand={onExpand}
        />,
      )
    }
  }
  return out
}
