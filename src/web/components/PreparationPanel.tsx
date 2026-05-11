import type { SessionStatus } from '@shared/types'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface PrepStep {
  phase: string
  detail?: string
  ts: number
}

interface Props {
  steps: PrepStep[]
  status: SessionStatus
}

// Renders the prep-phase progress that runs between "rerun clicked" and
// "agent spawned". The server emits `progress` SSE events with phases
// prefixed `prep:` during this window — the parent (PRDetail) filters and
// pushes them into `steps`. Once the session leaves `pending` the panel
// disappears; the agent output panel takes over as the live transcript.
export function PreparationPanel({ steps, status }: Props) {
  if (status !== 'pending') return null
  if (steps.length === 0) return null

  return (
    <div
      className="rounded-md border border-rule bg-raised/40"
      role="status"
      aria-live="polite"
      aria-label="Review preparation progress"
    >
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-rule">
        <span className="text-caps tracking-caps text-ink-muted uppercase">准备中</span>
        <span className="inline-flex items-center gap-1.5 text-caps tracking-caps text-accent-running uppercase">
          <span
            className="inline-block size-1.5 rounded-full bg-accent-running animate-running-pulse"
            aria-hidden="true"
          />
          working
        </span>
        <span className="ml-auto font-mono text-meta text-ink-secondary tabular-nums">
          {steps.length}
        </span>
      </div>
      <ol className="px-4 py-3 space-y-1.5">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1
          return (
            <li
              key={`${s.ts}-${s.phase}`}
              className={cn(
                'flex items-baseline gap-2.5 font-mono text-code',
                isLast ? 'text-ink-primary' : 'text-ink-secondary',
              )}
            >
              <span className="text-meta text-ink-muted tabular-nums w-5 shrink-0">{i + 1}.</span>
              <span className="flex-1 break-words">{s.detail ?? s.phase}</span>
              {isLast ? (
                <span
                  className="inline-block size-1.5 rounded-full bg-accent-running animate-running-pulse"
                  aria-hidden="true"
                />
              ) : (
                <Check size={12} className="text-ink-muted shrink-0" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
