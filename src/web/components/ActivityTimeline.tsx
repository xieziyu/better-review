import type { AgentKind, PrepCall, PrepStep, SessionStatus } from '@shared/types'
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TranscriptStream } from '@/components/TranscriptStream'
import { cn } from '@/lib/utils'

interface Props {
  prepSteps: PrepStep[]
  prepCalls: PrepCall[]
  chunks: string[]
  status: SessionStatus
  agent?: AgentKind | undefined
}

type NodeStatus = 'done' | 'done-muted' | 'running' | 'pending' | 'failed' | 'cancelled'

interface PhaseBucket {
  phase: string
  firstTs: number
  calls: PrepCall[]
}

function useTick(intervalMs: number, enabled: boolean) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setTick((n) => n + 1), intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs])
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const m = Math.floor(ms / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

function bucketize(steps: PrepStep[], calls: PrepCall[]): PhaseBucket[] {
  const byPhase = new Map<string, PhaseBucket>()
  for (const s of steps) {
    if (!byPhase.has(s.phase)) {
      byPhase.set(s.phase, { phase: s.phase, firstTs: s.ts, calls: [] })
    }
  }
  for (const c of calls) {
    let b = byPhase.get(c.phase)
    if (!b) {
      b = { phase: c.phase, firstTs: c.ts, calls: [] }
      byPhase.set(c.phase, b)
    }
    b.calls.push(c)
  }
  return Array.from(byPhase.values()).sort((a, b) => a.firstTs - b.firstTs)
}

export function ActivityTimeline({ prepSteps, prepCalls, chunks, status, agent }: Props) {
  const { t } = useTranslation()
  const isPending = status === 'pending'
  const isRunning = status === 'running'
  const ticking = isPending || isRunning

  // Drive elapsed-counter re-renders for the active node every second.
  useTick(1000, ticking)

  const buckets = useMemo(() => bucketize(prepSteps, prepCalls), [prepSteps, prepCalls])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [agentBodyOpen, setAgentBodyOpen] = useState(true)

  const togglePhase = (phase: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(phase)) next.delete(phase)
      else next.add(phase)
      return next
    })
  }

  // Last prep step's ts is our best proxy for "when the agent started" since
  // the session row carries no explicit agentStartedAt — see plan.
  const lastPrepTs = prepSteps.length > 0 ? prepSteps[prepSteps.length - 1]!.ts : null

  const now = Date.now()

  return (
    <ul
      aria-label={t('activityTimeline.ariaLabel')}
      className="flex flex-col min-h-0 h-full overflow-hidden"
    >
      {buckets.map((b, i) => {
        const isLast = i === buckets.length - 1
        // Wall-clock duration: bounded by next bucket start or now if active.
        const endTs = isLast
          ? isPending
            ? now
            : (lastPrepTs ?? b.firstTs)
          : buckets[i + 1]!.firstTs
        const wallMs = Math.max(0, endTs - b.firstTs)
        const hasCalls = b.calls.length > 0
        // Active prep bucket = last bucket while session is still in pending.
        const nodeStatus: NodeStatus =
          isPending && isLast ? 'running' : hasCalls ? 'done' : 'done-muted'
        const isOpen = expanded.has(b.phase)
        const label = t(`prep.phase.${b.phase}`, { defaultValue: b.phase })
        return (
          <li key={b.phase} className="shrink-0">
            <TimelineRow
              status={nodeStatus}
              connectTop={i > 0}
              connectBottom
              header={
                <button
                  type="button"
                  onClick={() => hasCalls && togglePhase(b.phase)}
                  aria-expanded={hasCalls ? isOpen : undefined}
                  disabled={!hasCalls}
                  className={cn(
                    'flex-1 min-w-0 flex items-center gap-2 text-left',
                    hasCalls ? 'hover:bg-raised/60 cursor-pointer' : 'cursor-default',
                    'transition-colors duration-180 ease-out-quart rounded px-1',
                  )}
                >
                  {hasCalls ? (
                    isOpen ? (
                      <ChevronDown
                        size={12}
                        className="shrink-0 text-ink-muted"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        size={12}
                        className="shrink-0 text-ink-muted"
                        aria-hidden="true"
                      />
                    )
                  ) : null}
                  <span
                    className={cn(
                      'text-meta truncate',
                      nodeStatus === 'done-muted' ? 'text-ink-muted' : 'text-ink-primary',
                    )}
                  >
                    {label}
                  </span>
                  <span className="ml-auto flex items-center gap-3 shrink-0 font-mono text-meta text-ink-muted tabular-nums">
                    {hasCalls ? (
                      <span className="text-ink-secondary">
                        {t('activityTimeline.callsCount', { count: b.calls.length })}
                      </span>
                    ) : (
                      <span className="italic">{t('activityTimeline.inProcess')}</span>
                    )}
                    <span>{formatDuration(wallMs)}</span>
                  </span>
                </button>
              }
              body={
                hasCalls && isOpen ? (
                  <ul className="pl-7 pr-2 pb-2 space-y-2">
                    {b.calls.map((c, idx) => (
                      <CallRow key={`${c.ts}-${idx}`} call={c} />
                    ))}
                  </ul>
                ) : null
              }
            />
          </li>
        )
      })}

      <li className="flex-1 min-h-0 flex flex-col">
        <AgentNode
          status={status}
          chunks={chunks}
          agent={agent}
          startedAt={lastPrepTs}
          now={now}
          connectTop={buckets.length > 0}
          open={agentBodyOpen}
          onToggle={() => setAgentBodyOpen((v) => !v)}
        />
      </li>
    </ul>
  )
}

interface TimelineRowProps {
  status: NodeStatus
  connectTop: boolean
  connectBottom: boolean
  header: React.ReactNode
  body?: React.ReactNode
}

function TimelineRow({ status, connectTop, connectBottom, header, body }: TimelineRowProps) {
  return (
    <div className="relative grid grid-cols-[28px_1fr] gap-2 px-4 py-1.5">
      <div className="relative flex justify-center">
        {connectTop ? (
          <span
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 top-0 h-3 w-px bg-rule"
          />
        ) : null}
        {connectBottom ? (
          <span
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 top-5 bottom-[-6px] w-px bg-rule"
          />
        ) : null}
        <NodeRing status={status} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center min-h-5">{header}</div>
        {body}
      </div>
    </div>
  )
}

function NodeRing({ status }: { status: NodeStatus }) {
  const common =
    'relative z-[1] mt-[3px] inline-flex size-3.5 items-center justify-center rounded-full'
  if (status === 'done') {
    return (
      <span className={cn(common, 'bg-accent-ready text-canvas')} aria-hidden="true">
        <Check size={9} strokeWidth={3} />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className={cn(common, 'bg-severity-must text-canvas')} aria-hidden="true">
        <X size={9} strokeWidth={3} />
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span
        className={cn(
          common,
          'border-2 border-accent-active bg-canvas motion-safe:animate-running-pulse',
        )}
        aria-hidden="true"
      />
    )
  }
  if (status === 'done-muted') {
    return (
      <span
        className={cn(common, 'border-2 border-dashed border-rule bg-canvas')}
        aria-hidden="true"
      />
    )
  }
  if (status === 'cancelled') {
    return (
      <span
        className={cn(common, 'border-2 border-dashed border-ink-muted bg-canvas')}
        aria-hidden="true"
      />
    )
  }
  // pending
  return <span className={cn(common, 'border-2 border-rule bg-raised')} aria-hidden="true" />
}

function CallRow({ call }: { call: PrepCall }) {
  const { t } = useTranslation()
  return (
    <li className="text-meta">
      <div className="font-mono text-ink-secondary truncate">
        <span className="text-ink-muted">$ </span>
        {call.command.join(' ')}
      </div>
      <div className="font-mono text-ink-muted text-[11px]">
        {t('activityTimeline.callSummary', {
          exit: call.exitCode ?? '?',
          stdout: call.stdout.length,
          stderr: call.stderr.length,
          ms: call.durationMs,
        })}
      </div>
      {call.stdout.length > 0 ? (
        <pre className="mt-1 font-mono text-[11.5px] leading-[16px] text-ink-primary whitespace-pre-wrap break-words bg-sunken/60 px-2 py-1 max-h-40 overflow-y-auto">
          {call.stdout}
        </pre>
      ) : null}
      {call.stderr.length > 0 ? (
        <pre className="mt-1 font-mono text-[11.5px] leading-[16px] text-severity-must whitespace-pre-wrap break-words bg-sunken/60 px-2 py-1 max-h-40 overflow-y-auto">
          {call.stderr}
        </pre>
      ) : null}
    </li>
  )
}

interface AgentNodeProps {
  status: SessionStatus
  chunks: string[]
  agent?: AgentKind | undefined
  startedAt: number | null
  now: number
  connectTop: boolean
  open: boolean
  onToggle: () => void
}

function AgentNode({
  status,
  chunks,
  agent,
  startedAt,
  now,
  connectTop,
  open,
  onToggle,
}: AgentNodeProps) {
  const { t } = useTranslation()

  const nodeStatus: NodeStatus =
    status === 'running'
      ? 'running'
      : status === 'pending'
        ? 'pending'
        : status === 'failed'
          ? 'failed'
          : status === 'cancelled'
            ? 'cancelled'
            : 'done'

  const isStreaming = status === 'running' || (status === 'pending' && chunks.length > 0)
  const showBody = open && (chunks.length > 0 || isStreaming)

  // Elapsed time: only meaningful once the agent has actually started (status
  // running) or once chunks have arrived. While prep is still mid-flight we
  // suppress the elapsed display.
  const elapsedMs = status === 'running' && startedAt ? Math.max(0, now - startedAt) : null

  const baseLabel = t('activityTimeline.agentNode.label')
  const fullLabel = agent ? `${baseLabel} — ${agent}` : baseLabel

  const meta: string[] = []
  if (chunks.length > 0)
    meta.push(t('activityTimeline.agentNode.linesCount', { count: chunks.length }))
  if (elapsedMs != null) meta.push(formatDuration(elapsedMs))
  if (nodeStatus === 'running') meta.push(t('activityTimeline.statusRunning'))
  else if (nodeStatus === 'pending') meta.push(t('activityTimeline.statusPending'))
  else if (nodeStatus === 'failed') meta.push(t('activityTimeline.statusFailed'))
  else if (nodeStatus === 'cancelled') meta.push(t('activityTimeline.statusCancelled'))

  return (
    <div className="relative grid grid-cols-[28px_1fr] gap-2 px-4 py-1.5 flex-1 min-h-0">
      <div className="relative flex justify-center">
        {connectTop ? (
          <span
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2 top-0 h-3 w-px bg-rule"
          />
        ) : null}
        <NodeRing status={nodeStatus} />
      </div>
      <div className="min-w-0 flex flex-col min-h-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="activity-timeline-agent-body"
          className={cn(
            'flex items-center min-h-5 gap-2 text-left rounded px-1',
            'hover:bg-raised/60 transition-colors duration-180 ease-out-quart cursor-pointer',
          )}
        >
          {open ? (
            <ChevronDown size={12} className="shrink-0 text-ink-muted" aria-hidden="true" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-ink-muted" aria-hidden="true" />
          )}
          <span
            className={cn(
              'text-meta truncate',
              nodeStatus === 'pending' || nodeStatus === 'cancelled'
                ? 'text-ink-muted'
                : 'text-ink-primary',
            )}
          >
            {fullLabel}
          </span>
          <span className="ml-auto flex items-center gap-3 shrink-0 font-mono text-meta text-ink-muted tabular-nums">
            {meta.map((m, idx) => (
              <span
                key={idx}
                className={cn(
                  idx === meta.length - 1 &&
                    nodeStatus === 'running' &&
                    'text-accent-active uppercase tracking-caps text-caps',
                  idx === meta.length - 1 &&
                    nodeStatus === 'failed' &&
                    'text-severity-must uppercase tracking-caps text-caps',
                )}
              >
                {m}
              </span>
            ))}
          </span>
        </button>
        {showBody ? (
          <div
            id="activity-timeline-agent-body"
            className="mt-1.5 flex-1 min-h-0 border border-rule rounded overflow-hidden"
          >
            <TranscriptStream chunks={chunks} status={status} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
