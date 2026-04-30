import { AGENT_KINDS } from '@shared/types'
import { useQuery } from '@tanstack/react-query'

import { Tag } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'

const CONFIG_SNIPPET = `{
  "port": 0,
  "idleShutdownMinutes": 240,
  "maxConcurrentReviews": 4,
  "stallMinutes": 3,
  "defaultAgent": "claude",
  "perPRGCDays": 7
}`

const CONFIG_KEYS: Array<{ key: string; description: string }> = [
  {
    key: 'idleShutdownMinutes',
    description: 'Auto-shutdown when no browser tab is connected for this many minutes.',
  },
  {
    key: 'maxConcurrentReviews',
    description: 'How many agent processes may run in parallel.',
  },
  {
    key: 'stallMinutes',
    description: 'Watchdog kills an agent run with no stdout for this many minutes.',
  },
  {
    key: 'defaultAgent',
    description: 'Which review agent to use when a session does not specify one.',
  },
  {
    key: 'perPRGCDays',
    description: 'Garbage-collect per-PR workdirs after this many days.',
  },
]

function Row({
  label,
  value,
  testId,
  trail,
}: {
  label: string
  value: React.ReactNode
  testId?: string
  trail?: React.ReactNode
}) {
  return (
    <>
      <dt className="text-caps tracking-caps text-ink-muted uppercase pt-3 border-t border-rule">
        {label}
      </dt>
      <dd
        data-testid={testId}
        className="font-mono text-meta text-ink-primary tabular-nums break-all pt-3 border-t border-rule flex items-center gap-2 flex-wrap"
      >
        <span className="min-w-0 break-all">{value}</span>
        {trail ? <span className="ml-auto">{trail}</span> : null}
      </dd>
    </>
  )
}

export function Settings() {
  const { data: health } = useQuery({ queryKey: queryKeys.health, queryFn: api.health })

  return (
    <div className="px-8 py-10 mx-auto max-w-2xl space-y-12">
      <header>
        <div className="text-caps tracking-caps text-ink-muted uppercase mb-2">Settings</div>
        <h1 className="text-display text-ink-primary">Runtime</h1>
        <p className="mt-3 text-body text-ink-secondary">
          better-review reads its configuration from{' '}
          <code className="font-mono text-code text-ink-primary bg-sunken px-1 py-0.5 rounded-sm">
            ~/.better-review/config.json
          </code>
          . Edit that file and restart the daemon to apply changes.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-caps tracking-caps text-ink-muted uppercase">Defaults</h2>
        <pre
          data-testid="config-snippet"
          className="font-mono text-code text-ink-primary p-4 rounded-md bg-sunken border border-rule overflow-auto"
        >
          {CONFIG_SNIPPET}
        </pre>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 pt-2">
          {CONFIG_KEYS.map((k) => (
            <div key={k.key} className="contents">
              <dt className="font-mono text-code text-ink-secondary">{k.key}</dt>
              <dd className="text-meta text-ink-secondary">{k.description}</dd>
            </div>
          ))}
        </dl>
        <p className="text-meta text-ink-muted pt-2">
          <code className="font-mono">claudeStallMinutes</code> is accepted as a deprecated alias
          for <code className="font-mono">stallMinutes</code>.
        </p>
      </section>

      {health ? (
        <section className="space-y-2">
          <h2 className="text-caps tracking-caps text-ink-muted uppercase">Daemon</h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6">
            <Row label="pid" value={health.daemon.pid} testId="daemon-pid" />
            <Row label="port" value={health.daemon.port} testId="daemon-port" />
            <Row
              label="started"
              value={new Date(health.daemon.startedAt).toLocaleString()}
              trail={undefined}
            />
            <Row label="default agent" value={health.defaultAgent} testId="default-agent" />
            {AGENT_KINDS.map((k) => (
              <Row
                key={k}
                label={k}
                value={health.agents[k].path ?? '(not found)'}
                testId={`${k}-path`}
                trail={
                  health.agents[k].found ? null : <Tag tone="danger">missing</Tag>
                }
              />
            ))}
            <Row
              label="gh"
              value={health.gh.path ?? '(not found)'}
              testId="gh-path"
              trail={
                !health.gh.found ? (
                  <Tag tone="danger">missing</Tag>
                ) : !health.gh.authed ? (
                  <Tag tone="warning">not authed</Tag>
                ) : (
                  <Tag tone="neutral">authed</Tag>
                )
              }
            />
          </dl>
        </section>
      ) : null}
    </div>
  )
}
