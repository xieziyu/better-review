import type { PrepCall, PrepStep } from '@shared/types'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

interface Props {
  steps: PrepStep[]
  calls: PrepCall[]
}

interface PhaseBucket {
  phase: string
  firstTs: number
  calls: PrepCall[]
}

/**
 * Renders the prep-phase timeline above the agent transcript inside the
 * TranscriptDrawer. Each entered phase gets a row; rows with captured gh
 * calls are expandable to reveal each call's command + stdout/stderr. Phases
 * with no captured output (in-process steps like `prep:rendering-prompt`)
 * render as muted rows with no expand affordance.
 */
export function PrepPhasesPanel({ steps, calls }: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const buckets = useMemo<PhaseBucket[]>(() => {
    const byPhase = new Map<string, PhaseBucket>()
    // Seed in the order phases were entered so the timeline reflects reality.
    for (const s of steps) {
      if (!byPhase.has(s.phase)) {
        byPhase.set(s.phase, { phase: s.phase, firstTs: s.ts, calls: [] })
      }
    }
    // Then attach calls. Calls may belong to a phase that hasn't yet been
    // markPhased on the client (race between progress + prep-output events) —
    // create a synthetic bucket on the fly.
    for (const c of calls) {
      let b = byPhase.get(c.phase)
      if (!b) {
        b = { phase: c.phase, firstTs: c.ts, calls: [] }
        byPhase.set(c.phase, b)
      }
      b.calls.push(c)
    }
    return Array.from(byPhase.values()).sort((a, b) => a.firstTs - b.firstTs)
  }, [steps, calls])

  if (buckets.length === 0) return null

  const toggle = (phase: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(phase)) next.delete(phase)
      else next.add(phase)
      return next
    })
  }

  return (
    <section
      aria-label={t('transcriptDrawer.prepEyebrow')}
      className="shrink-0 max-h-[40%] overflow-y-auto border-b border-rule bg-canvas/40"
    >
      <div className="px-4 pt-2 pb-1 text-caps tracking-caps uppercase text-ink-secondary">
        {t('transcriptDrawer.prepEyebrow')}
      </div>
      <ul className="pb-1">
        {buckets.map((b) => {
          const totalMs = b.calls.reduce((sum, c) => sum + c.durationMs, 0)
          const hasCalls = b.calls.length > 0
          const isOpen = expanded.has(b.phase)
          const label = t(`prep.phase.${b.phase}`, { defaultValue: b.phase })
          return (
            <li key={b.phase} className="border-t border-rule first:border-t-0">
              <button
                type="button"
                onClick={() => hasCalls && toggle(b.phase)}
                aria-expanded={hasCalls ? isOpen : undefined}
                disabled={!hasCalls}
                className={cn(
                  'w-full px-4 py-1.5 flex items-center gap-2 text-left',
                  hasCalls ? 'hover:bg-raised cursor-pointer' : 'cursor-default text-ink-muted',
                  'transition-colors duration-180 ease-out-quart',
                )}
              >
                {hasCalls ? (
                  isOpen ? (
                    <ChevronDown size={12} className="shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight size={12} className="shrink-0" aria-hidden="true" />
                  )
                ) : (
                  <span className="inline-block size-3 shrink-0" aria-hidden="true" />
                )}
                <span
                  className={cn(
                    'text-meta truncate',
                    hasCalls ? 'text-ink-primary' : 'text-ink-muted',
                  )}
                >
                  {label}
                </span>
                <span className="ml-auto flex items-center gap-3 shrink-0 font-mono text-meta text-ink-muted tabular-nums">
                  {hasCalls ? (
                    <>
                      <span>{t('transcriptDrawer.prepCallsCount', { count: b.calls.length })}</span>
                      <span>{totalMs}ms</span>
                    </>
                  ) : (
                    <span className="italic">{t('transcriptDrawer.prepNoOutput')}</span>
                  )}
                </span>
              </button>
              {hasCalls && isOpen ? (
                <ul className="pb-1 pl-7 pr-4 space-y-2">
                  {b.calls.map((c, idx) => (
                    <li key={`${c.ts}-${idx}`} className="text-meta">
                      <div className="font-mono text-ink-secondary truncate">
                        <span className="text-ink-muted">$ </span>
                        {c.command.join(' ')}
                      </div>
                      <div className="font-mono text-ink-muted text-[11px]">
                        {t('transcriptDrawer.prepCallSummary', {
                          exit: c.exitCode ?? '?',
                          stdout: c.stdout.length,
                          stderr: c.stderr.length,
                          ms: c.durationMs,
                        })}
                      </div>
                      {c.stdout.length > 0 ? (
                        <pre className="mt-1 font-mono text-[11.5px] leading-[16px] text-ink-primary whitespace-pre-wrap break-words bg-sunken/60 px-2 py-1 max-h-40 overflow-y-auto">
                          {c.stdout}
                        </pre>
                      ) : null}
                      {c.stderr.length > 0 ? (
                        <pre className="mt-1 font-mono text-[11.5px] leading-[16px] text-severity-must whitespace-pre-wrap break-words bg-sunken/60 px-2 py-1 max-h-40 overflow-y-auto">
                          {c.stderr}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
