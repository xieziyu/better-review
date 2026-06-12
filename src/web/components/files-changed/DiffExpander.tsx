import { ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { Decoration } from 'react-diff-view'
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
