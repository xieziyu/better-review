import type { PrepStep, PRSession, SessionStatus } from '@shared/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KbdHint } from '@/components/ui'
import { cn } from '@/lib/utils'

interface RunStripProps {
  session: PRSession
  prepSteps: PrepStep[]
  findingsCount: number
  transcriptOpen: boolean
  onToggleTranscript: () => void
}

type StripMode = 'prep' | 'reviewing' | 'review'

function modeFor(status: SessionStatus): StripMode | null {
  if (status === 'pending') return 'prep'
  if (status === 'running') return 'reviewing'
  if (status === 'ready') return 'review'
  return null
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * One-line live status row that lives between PR header and findings body.
 * Three modes:
 *   - prep      (session.status === 'pending'): preparing the review run.
 *   - reviewing (session.status === 'running'): the agent is producing findings.
 *   - review    (session.status === 'ready'):   agent done, awaiting human submit.
 * Hides entirely once the session reaches submitted/archived/failed/cancelled.
 * Prep and reviewing share the live treatment (pulse, ticker, indeterminate
 * progress bar). Review is static: it just keeps the strip on screen so the
 * workbench has a continuous status row across the whole lifecycle.
 */
export function RunStrip({
  session,
  prepSteps,
  findingsCount,
  transcriptOpen,
  onToggleTranscript,
}: RunStripProps) {
  const { t } = useTranslation()
  const mode = modeFor(session.status)
  const isLive = mode === 'prep' || mode === 'reviewing'
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (!isLive) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [isLive])

  if (mode === null) return null

  const phaseLabel =
    mode === 'review'
      ? t('runStrip.phase.review')
      : mode === 'reviewing'
        ? t('runStrip.phase.reviewing')
        : t('runStrip.phase.prep')

  let detail: string
  if (mode === 'reviewing') {
    detail =
      findingsCount === 0
        ? t('runStrip.reviewingScanning', { agent: session.agent })
        : t('runStrip.reviewingDetail', { agent: session.agent, count: findingsCount })
  } else if (mode === 'review') {
    detail = t('runStrip.reviewDetail', { count: findingsCount })
  } else {
    const lastPrep = prepSteps[prepSteps.length - 1]
    detail = lastPrep
      ? t(`prep.phase.${lastPrep.phase}`, {
          defaultValue: lastPrep.detail ?? lastPrep.phase,
          agent: lastPrep.detail ?? '',
        })
      : t('runStrip.startingUp')
  }

  const elapsed = formatElapsed(now - session.createdAt)
  const srLabel = isLive ? `${phaseLabel} ${detail} ${elapsed}` : `${phaseLabel} ${detail}`

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('runStrip.ariaLabel')}
      className="shrink-0 border-b border-rule bg-sunken/60"
    >
      <span className="sr-only">{srLabel}</span>

      <div className="px-8 h-10 flex items-center gap-4">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-caps tracking-caps uppercase shrink-0',
            isLive ? 'text-accent-running' : 'text-ink-secondary',
          )}
        >
          {isLive ? (
            <span
              className="inline-block size-1.5 rounded-full bg-accent-running motion-safe:animate-running-pulse"
              aria-hidden="true"
            />
          ) : (
            <span className="inline-block size-1.5 rounded-full bg-ink-muted" aria-hidden="true" />
          )}
          {phaseLabel}
        </span>

        <span className="text-ink-muted shrink-0" aria-hidden="true">
          ·
        </span>

        <span className="min-w-0 flex-1 truncate font-mono text-meta text-ink-secondary">
          {detail}
        </span>

        {isLive ? (
          <span className="font-mono text-meta text-ink-muted tabular-nums shrink-0">
            {elapsed}
          </span>
        ) : null}

        <button
          type="button"
          onClick={onToggleTranscript}
          aria-expanded={transcriptOpen}
          aria-controls="transcript-drawer-body"
          aria-label={t('runStrip.transcriptToggleAria')}
          className={cn(
            'shrink-0 inline-flex items-center gap-2 h-7 px-2.5 rounded-sm',
            'border border-rule text-meta text-ink-secondary',
            'hover:text-ink-primary hover:border-ink-muted hover:bg-raised',
            'transition-colors duration-180 ease-out-quart',
          )}
        >
          <span>{t('runStrip.transcript')}</span>
          <KbdHint keys={['⌘', 'J']} />
        </button>
      </div>

      {isLive ? (
        <div className="relative h-0.5 w-full overflow-hidden bg-rule/60" aria-hidden="true">
          <div className="absolute inset-y-0 w-1/4 bg-accent-running motion-safe:animate-progress-indeterminate" />
        </div>
      ) : (
        <div className="h-0.5 w-full bg-rule/60" aria-hidden="true" />
      )}
    </div>
  )
}
