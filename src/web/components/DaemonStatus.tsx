import { AGENT_KINDS, type HealthStatus } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AgentRow, PresenceMark } from '@/components/AgentList'
import { Tag } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'
import { useUptime } from '@/lib/format'
import { cn } from '@/lib/utils'

type Severity = 'ok' | 'warn' | 'block'

function severityFrom(h: HealthStatus): Severity {
  const def = h.agents[h.defaultAgent]
  if (!def?.found) return 'block'
  if (!h.gh.found || !h.gh.authed) return 'block'
  for (const k of AGENT_KINDS) if (!h.agents[k].found) return 'warn'
  return 'ok'
}

const dotByLevel: Record<Severity, string> = {
  ok: 'bg-accent-ready',
  warn: 'bg-severity-should',
  block: 'bg-severity-must',
}

export function DaemonStatus() {
  const { t } = useTranslation()
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
  const labelByLevel: Record<Severity, string> = {
    ok: t('daemon.healthy'),
    warn: t('daemon.warnings'),
    block: t('daemon.blockers'),
  }
  const buttonLabel = data ? labelByLevel[sev] : t('daemon.status')

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
  const { t } = useTranslation()
  const uptime = useUptime()
  const sev = severityFrom(data)

  return (
    <div
      role="dialog"
      aria-label={t('daemon.popoverAria')}
      className="absolute left-[calc(100%+8px)] bottom-0 z-30 w-[22rem] rounded-md border border-rule bg-canvas text-left shadow-[0_8px_30px_-12px_color-mix(in_oklch,var(--ink-primary)_30%,transparent)]"
    >
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <span aria-hidden="true" className={cn('size-2.5 rounded-full', dotByLevel[sev])} />
        <div className="flex-1 min-w-0">
          <div className="text-h2 text-ink-primary leading-tight">
            {t('daemon.upFor', { uptime: uptime(data.daemon.startedAt, now) })}
          </div>
          <div className="text-meta text-ink-muted font-mono tabular-nums">
            pid {data.daemon.pid} · port {data.daemon.port}
          </div>
        </div>
      </header>

      <Section label={t('daemon.agents')}>
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

      <Section label={t('daemon.tools')}>
        <div className="flex items-center gap-2 min-w-0">
          <PresenceMark ok={data.gh.found} />
          <span className="text-meta text-ink-secondary w-12 shrink-0">gh</span>
          <span className="font-mono text-code text-ink-secondary truncate flex-1">
            {data.gh.path ?? t('daemon.notFound')}
          </span>
          <GhAuthTag found={data.gh.found} authed={data.gh.authed} />
        </div>
      </Section>

      <Section label={t('daemon.paths')} last>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 min-w-0">
          <dt className="text-meta text-ink-muted">{t('daemon.home')}</dt>
          <dd
            className="font-mono text-code text-ink-secondary truncate min-w-0"
            title={data.daemon.home}
          >
            {data.daemon.home}
          </dd>
          <dt className="text-meta text-ink-muted">{t('daemon.log')}</dt>
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

function GhAuthTag({ found, authed }: { found: boolean; authed: boolean }) {
  const { t } = useTranslation()
  if (!found) return <Tag tone="danger">{t('daemon.missing')}</Tag>
  if (!authed) return <Tag tone="warning">{t('daemon.notAuthed')}</Tag>
  return <Tag tone="success">{t('daemon.authed')}</Tag>
}
