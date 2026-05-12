import type { PrepStep, PRSession } from '@shared/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KbdHint } from '@/components/ui'
import { cn } from '@/lib/utils'

interface RunStripProps {
  session: PRSession
  prepSteps: PrepStep[]
  agentEventCount: number
  transcriptOpen: boolean
  onToggleTranscript: () => void
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * One-line live status row that lives between PR header and findings body.
 * Visible only while the session is in flight (`pending` for prep, `running`
 * for the agent run). Replaces the discrete PreparationPanel and unifies the
 * two phases under one running clock.
 */
export function RunStrip({
  session,
  prepSteps,
  agentEventCount,
  transcriptOpen,
  onToggleTranscript,
}: RunStripProps) {
  const { t } = useTranslation()
  const inFlight = session.status === 'pending' || session.status === 'running'
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (!inFlight) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [inFlight])

  if (!inFlight) return null

  const isRunning = session.status === 'running'
  const phaseLabel = isRunning ? t('runStrip.phase.reviewing') : t('runStrip.phase.prep')

  const lastPrep = prepSteps[prepSteps.length - 1]
  const detail = isRunning
    ? t('runStrip.runningDetail', { agent: session.agent, count: agentEventCount })
    : lastPrep
      ? t(`prep.phase.${lastPrep.phase}`, {
          defaultValue: lastPrep.detail ?? lastPrep.phase,
          agent: lastPrep.detail ?? '',
        })
      : t('runStrip.startingUp')

  const elapsed = formatElapsed(now - session.createdAt)
  const srLabel = `${phaseLabel} ${detail} ${elapsed}`

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('runStrip.ariaLabel')}
      className="shrink-0 border-b border-rule bg-sunken/60"
    >
      <span className="sr-only">{srLabel}</span>

      <div className="px-8 h-10 flex items-center gap-4">
        <span className="inline-flex items-center gap-1.5 text-caps tracking-caps uppercase text-accent-running shrink-0">
          <span
            className="inline-block size-1.5 rounded-full bg-accent-running motion-safe:animate-running-pulse"
            aria-hidden="true"
          />
          {phaseLabel}
        </span>

        <span className="text-ink-muted shrink-0" aria-hidden="true">
          ·
        </span>

        <span className="min-w-0 flex-1 truncate font-mono text-meta text-ink-secondary">
          {detail}
        </span>

        <span className="font-mono text-meta text-ink-muted tabular-nums shrink-0">{elapsed}</span>

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

      <div className="relative h-0.5 w-full overflow-hidden bg-rule/60" aria-hidden="true">
        <div className="absolute inset-y-0 w-1/4 bg-accent-running motion-safe:animate-progress-indeterminate" />
      </div>
    </div>
  )
}
