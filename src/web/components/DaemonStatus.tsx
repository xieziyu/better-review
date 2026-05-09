import { AGENT_KINDS, type AgentKind, type HealthStatus } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { Tag } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'

type Severity = 'ok' | 'warn' | 'block'

function severityFrom(h: HealthStatus): Severity {
  const def = h.agents[h.defaultAgent]
  if (!def?.found) return 'block'
  if (!h.gh.found || !h.gh.authed) return 'block'
  for (const k of AGENT_KINDS) if (!h.agents[k].found) return 'warn'
  return 'ok'
}

function formatUptime(startedAt: number, now: number): string {
  const ms = Math.max(0, now - startedAt)
  const totalMin = Math.floor(ms / 60_000)
  if (totalMin < 1) return 'just now'
  if (totalMin < 60) return `${totalMin}m`
  const totalHrs = Math.floor(totalMin / 60)
  const remMin = totalMin % 60
  if (totalHrs < 24) return `${totalHrs}h ${remMin}m`
  const days = Math.floor(totalHrs / 24)
  return `${days}d ${totalHrs % 24}h`
}

const dotByLevel: Record<Severity, string> = {
  ok: 'bg-accent-ready',
  warn: 'bg-severity-should',
  block: 'bg-severity-must',
}

const labelByLevel: Record<Severity, string> = {
  ok: 'Daemon healthy',
  warn: 'Daemon has warnings',
  block: 'Daemon has blockers',
}

export function DaemonStatus() {
  const { data } = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.health,
    refetchInterval: 30_000,
  })
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  // Keep uptime fresh while the popover is open without refetching health.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const tick = window.setInterval(() => setNow(Date.now()), 30_000)
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const sev: Severity = data ? severityFrom(data) : 'warn'
  const buttonLabel = data ? labelByLevel[sev] : 'Daemon status'

  return (
    <div ref={wrapRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center size-7 rounded-md hover:bg-raised transition-colors duration-180 ease-out-quart focus:outline-none focus-visible:border focus-visible:border-brand"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2 rounded-full',
            dotByLevel[sev],
            sev === 'block' ? 'animate-pulse' : '',
          )}
        />
      </button>
      {open && data ? <DaemonPopover data={data} now={now} /> : null}
    </div>
  )
}

function DaemonPopover({ data, now }: { data: HealthStatus; now: number }) {
  const sev = severityFrom(data)

  return (
    <div
      role="dialog"
      aria-label="Daemon status"
      className="absolute right-0 top-[calc(100%+8px)] z-30 w-[22rem] rounded-md border border-rule bg-canvas text-left shadow-[0_8px_30px_-12px_color-mix(in_oklch,var(--ink-primary)_30%,transparent)]"
    >
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <span aria-hidden="true" className={cn('size-2.5 rounded-full', dotByLevel[sev])} />
        <div className="flex-1 min-w-0">
          <div className="text-h2 text-ink-primary leading-tight">
            Daemon up {formatUptime(data.daemon.startedAt, now)}
          </div>
          <div className="text-meta text-ink-muted font-mono tabular-nums">
            pid {data.daemon.pid} · port {data.daemon.port}
          </div>
        </div>
      </header>

      <Section label="Agents">
        <ul className="space-y-1.5">
          {AGENT_KINDS.map((k) => (
            <AgentRow
              key={k}
              kind={k}
              path={data.agents[k].path}
              found={data.agents[k].found}
              isDefault={data.defaultAgent === k}
            />
          ))}
        </ul>
      </Section>

      <Section label="Tools">
        <div className="flex items-center gap-2 min-w-0">
          <PresenceMark ok={data.gh.found} />
          <span className="text-meta text-ink-secondary w-12 shrink-0">gh</span>
          <span className="font-mono text-code text-ink-secondary truncate flex-1">
            {data.gh.path ?? '(not found)'}
          </span>
          <GhAuthTag found={data.gh.found} authed={data.gh.authed} />
        </div>
      </Section>

      <Section label="Paths" last>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 min-w-0">
          <dt className="text-meta text-ink-muted">home</dt>
          <dd
            className="font-mono text-code text-ink-secondary truncate min-w-0"
            title={data.daemon.home}
          >
            {data.daemon.home}
          </dd>
          <dt className="text-meta text-ink-muted">log</dt>
          <dd
            className="font-mono text-code text-ink-secondary truncate min-w-0"
            title={data.daemon.logPath}
          >
            {data.daemon.logPath}
          </dd>
        </dl>
      </Section>
    </div>
  )
}

function Section({
  label,
  last,
  children,
}: {
  label: string
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={cn('px-4 py-3 border-t border-rule', last ? 'pb-4' : '')}>
      <div className="text-caps tracking-caps text-ink-muted uppercase mb-2">{label}</div>
      {children}
    </section>
  )
}

function PresenceMark({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center size-3.5 rounded-full text-[10px] font-bold leading-none shrink-0',
        ok ? 'bg-accent-ready/15 text-accent-ready' : 'bg-severity-must/15 text-severity-must',
      )}
    >
      {ok ? '✓' : '✗'}
    </span>
  )
}

function AgentRow({
  kind,
  path,
  found,
  isDefault,
}: {
  kind: AgentKind
  path: string | undefined
  found: boolean
  isDefault: boolean
}) {
  return (
    <li className="flex items-center gap-2 min-w-0">
      <PresenceMark ok={found} />
      <span className="text-meta text-ink-secondary w-12 shrink-0">{kind}</span>
      <span
        className="font-mono text-code text-ink-secondary truncate flex-1"
        title={path ?? '(not found)'}
      >
        {path ?? '(not found)'}
      </span>
      {isDefault ? <Tag tone="brand">default</Tag> : null}
    </li>
  )
}

function GhAuthTag({ found, authed }: { found: boolean; authed: boolean }) {
  if (!found) return <Tag tone="danger">missing</Tag>
  if (!authed) return <Tag tone="warning">not authed</Tag>
  return <Tag tone="success">authed</Tag>
}
