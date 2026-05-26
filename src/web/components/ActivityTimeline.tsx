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
  workdir?: string | undefined
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

export function ActivityTimeline({ prepSteps, prepCalls, chunks, status, agent, workdir }: Props) {
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
        const hasCalls = b.calls.length > 0
        // Sequential fallback: next bucket's start, or now/lastPrepTs for the
        // tail. This is correct for serial phases but underestimates phases
        // that run in parallel (loadingPriorReview + source prep are queued
        // back-to-back, then awaited together — the first appears as ~0ms and
        // the wall time gets absorbed into the second).
        const sequentialEndTs = isLast
          ? isPending
            ? now
            : (lastPrepTs ?? b.firstTs)
          : buckets[i + 1]!.firstTs
        // When this phase actually captured external calls, their timestamps
        // are the truth: callStart = ts - durationMs, callEnd = ts. Prefer
        // those over the sequential bound so parallel phases stop crediting
        // each other's time. Fall back to the sequential bound when there are
        // no calls (no observation data available).
        const callStartTs = hasCalls
          ? Math.min(...b.calls.map((c) => c.ts - c.durationMs))
          : b.firstTs
        const callEndTs = hasCalls ? Math.max(...b.calls.map((c) => c.ts)) : null
        const startTs = Math.min(b.firstTs, callStartTs)
        const endTs = callEndTs == null ? sequentialEndTs : Math.max(callEndTs, sequentialEndTs)
        const wallMs = Math.max(0, endTs - startTs)
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
                    'flex-1 min-w-0 flex items-center gap-3 text-left',
                    hasCalls ? 'hover:bg-raised/60 cursor-pointer' : 'cursor-default',
                    'transition-colors duration-180 ease-out-quart rounded px-1 -mx-1',
                  )}
                >
                  <span
                    className={cn(
                      'text-body truncate font-medium',
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
                    ) : nodeStatus === 'running' ? (
                      <span className="italic">{t('activityTimeline.inProcess')}</span>
                    ) : (
                      <span className="italic">{t('activityTimeline.noCapturedOutput')}</span>
                    )}
                    <span>{formatDuration(wallMs)}</span>
                    {hasCalls ? (
                      isOpen ? (
                        <ChevronDown size={14} className="shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronRight size={14} className="shrink-0" aria-hidden="true" />
                      )
                    ) : (
                      <span className="inline-block size-3.5 shrink-0" aria-hidden="true" />
                    )}
                  </span>
                </button>
              }
              body={
                hasCalls && isOpen ? (
                  <ul className="pl-1 pr-2 pb-2 pt-1 space-y-2">
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
          workdir={workdir}
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

// Row padding controls how generously the timeline breathes. Keep in sync
// with the rail offset values below — the rail segments are sized to bridge
// the py gap exactly, so changing py without bumping `-top-3`/`bottom-[-12px]`
// will leave visible gaps between consecutive ring rails.
function TimelineRow({ status, connectTop, connectBottom, header, body }: TimelineRowProps) {
  return (
    <div className="relative grid grid-cols-[28px_1fr] gap-3 px-4 py-3">
      <div className="relative flex justify-center items-start">
        {/* Top half of the rail — bridges the gap from the previous ring's bottom
            into this row's top padding. */}
        {connectTop ? (
          <span
            aria-hidden="true"
            className="absolute z-0 left-1/2 -translate-x-1/2 -top-3 h-3 w-px bg-rule"
          />
        ) : null}
        {/* Bottom half of the rail — bridges this ring's bottom into the next
            row's top padding so the two halves form a continuous line. */}
        {connectBottom ? (
          <span
            aria-hidden="true"
            className="absolute z-0 left-1/2 -translate-x-1/2 top-[14px] bottom-[-12px] w-px bg-rule"
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
  const common = 'relative z-[1] inline-flex size-3.5 items-center justify-center rounded-full'
  // Both 'done' and 'done-muted' share the green check ring — the ring tracks
  // lifecycle (done / running / pending / failed / cancelled). Whether a prep
  // phase had captured external output is a separate concern, surfaced via the
  // text tag next to the label, not the ring color/style.
  if (status === 'done' || status === 'done-muted') {
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

// The agent CLIs (`gh` in particular) return compact JSON. The mockup expects
// a readable indented block, so try to pretty-print when stdout parses as JSON.
function prettifyOutput(raw: string): string {
  const s = raw.trim()
  if (s.length === 0) return raw
  if (s[0] !== '{' && s[0] !== '[') return raw
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return raw
  }
}

function CallRow({ call }: { call: PrepCall }) {
  const exitOk = call.exitCode === 0
  const stdoutText = useMemo(() => prettifyOutput(call.stdout), [call.stdout])
  return (
    <li className="rounded-md border border-rule bg-canvas overflow-hidden">
      <div className="flex items-center gap-3 px-2.5 py-1.5 font-mono text-[12px] text-ink-secondary">
        <span className="truncate flex-1 min-w-0">
          <span className="text-ink-muted">$ </span>
          {call.command.join(' ')}
        </span>
        <span
          className={cn(
            'shrink-0 text-[11px]',
            exitOk ? 'text-accent-ready' : 'text-severity-must',
          )}
        >
          exit {call.exitCode ?? '?'}
        </span>
        <span className="shrink-0 text-[11px] text-ink-muted tabular-nums">
          {call.durationMs} ms
        </span>
      </div>
      {call.stdout.length > 0 ? (
        <pre className="border-t border-rule bg-sunken/60 px-2.5 py-2 font-mono text-[11.5px] leading-[16px] text-ink-primary whitespace-pre-wrap break-words max-h-40 overflow-auto">
          {stdoutText}
        </pre>
      ) : null}
      {call.stderr.length > 0 ? (
        <pre className="border-t border-rule bg-sunken/60 px-2.5 py-2 font-mono text-[11.5px] leading-[16px] text-severity-must whitespace-pre-wrap break-words max-h-40 overflow-auto">
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
  workdir?: string | undefined
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
  workdir,
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

  // Outer header shows status + elapsed; lines move into the inner card header
  // so the toggle row matches the prep rows in density.
  const trailing: { text: string; tone: 'muted' | 'active' | 'must' }[] = []
  if (elapsedMs != null) trailing.push({ text: formatDuration(elapsedMs), tone: 'muted' })
  if (nodeStatus === 'running')
    trailing.push({ text: t('activityTimeline.statusRunning'), tone: 'active' })
  else if (nodeStatus === 'pending')
    trailing.push({ text: t('activityTimeline.statusPending'), tone: 'muted' })
  else if (nodeStatus === 'failed')
    trailing.push({ text: t('activityTimeline.statusFailed'), tone: 'must' })
  else if (nodeStatus === 'cancelled')
    trailing.push({ text: t('activityTimeline.statusCancelled'), tone: 'muted' })

  return (
    <div className="relative grid grid-cols-[28px_1fr] gap-3 px-4 pt-3 pb-3 flex-1 min-h-0">
      <div className="relative flex justify-center items-start">
        {connectTop ? (
          <span
            aria-hidden="true"
            className="absolute z-0 left-1/2 -translate-x-1/2 -top-3 h-3 w-px bg-rule"
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
            'flex items-center min-h-5 gap-3 text-left rounded px-1 -mx-1',
            'hover:bg-raised/60 transition-colors duration-180 ease-out-quart cursor-pointer',
          )}
        >
          <span
            className={cn(
              'text-body truncate font-medium',
              nodeStatus === 'pending' || nodeStatus === 'cancelled'
                ? 'text-ink-muted'
                : 'text-ink-primary',
            )}
          >
            {fullLabel}
          </span>
          <span className="ml-auto flex items-center gap-3 shrink-0 font-mono text-meta text-ink-muted tabular-nums">
            {trailing.map((m, idx) => (
              <span
                key={idx}
                className={cn(
                  m.tone === 'active' && 'text-accent-active uppercase tracking-caps text-caps',
                  m.tone === 'must' && 'text-severity-must uppercase tracking-caps text-caps',
                )}
              >
                {m.text}
              </span>
            ))}
            {open ? (
              <ChevronDown size={14} className="shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight size={14} className="shrink-0" aria-hidden="true" />
            )}
          </span>
        </button>
        {showBody ? (
          <div
            id="activity-timeline-agent-body"
            className="mt-2 flex-1 min-h-0 flex flex-col border border-rule rounded-md overflow-hidden bg-canvas"
          >
            <div className="flex items-center gap-3 px-3 py-1.5 border-b border-rule bg-raised/60 text-meta text-ink-secondary">
              {agent ? (
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-sm border border-rule bg-canvas text-ink-secondary">
                  {agent} exec
                </span>
              ) : null}
              {workdir ? (
                <span className="truncate font-mono text-[11px] text-ink-muted" title={workdir}>
                  workdir: {workdir.replace(/^\/Users\/[^/]+/, '~')}
                </span>
              ) : null}
              <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-muted tabular-nums">
                {t('activityTimeline.agentNode.linesCount', { count: chunks.length })}
              </span>
            </div>
            <div className="flex-1 min-h-0">
              <TranscriptStream chunks={chunks} status={status} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
