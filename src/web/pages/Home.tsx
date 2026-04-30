import type { AgentKind, PRSession } from '@shared/types'
import { AGENT_KINDS } from '@shared/types'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button, EmptyState, KbdHint, Tag } from '@/components/ui'
import { api, queryKeys, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

const STATUS_TONE: Record<
  PRSession['status'],
  'running' | 'success' | 'warning' | 'danger' | 'neutral'
> = {
  running: 'running',
  pending: 'warning',
  ready: 'success',
  failed: 'danger',
  submitted: 'neutral',
  archived: 'neutral',
  cancelled: 'neutral',
}

function relativeTime(updatedAt: number): string {
  const diffMs = Date.now() - updatedAt
  if (diffMs < 0) return 'just now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function RecentRow({ session }: { session: PRSession }) {
  return (
    <Link
      to={`/pr/${session.id}`}
      className="group block py-3 border-b border-rule last:border-b-0"
    >
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-meta text-ink-secondary tabular-nums">
          {session.owner}/{session.repo}#{session.number}
        </span>
        <Tag tone={STATUS_TONE[session.status]}>{session.status}</Tag>
        <span className="ml-auto text-caps tracking-caps text-ink-muted uppercase">
          {relativeTime(session.updatedAt)}
        </span>
      </div>
      <div className="mt-1 text-h2 text-ink-primary group-hover:text-brand transition-colors duration-180 ease-out-quart">
        {session.title ?? '(no title)'}
      </div>
      {session.author ? (
        <div className="mt-0.5 font-mono text-meta text-ink-muted">@{session.author}</div>
      ) : null}
    </Link>
  )
}

export function Home() {
  const [input, setInput] = useState('')
  const [agent, setAgent] = useState<AgentKind | null>(null)
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: sessions = [] } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: api.listSessions,
  })
  const { data: health } = useQuery({ queryKey: queryKeys.health, queryFn: api.health })
  const create = useMutation({
    mutationFn: api.createSession,
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions })
      nav(`/pr/${id}`)
    },
  })

  useEffect(() => {
    if (agent === null && health) setAgent(health.defaultAgent)
  }, [agent, health])

  const trimmed = input.trim()
  const recent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3)
  const effectiveAgent = agent ?? health?.defaultAgent ?? 'claude'

  return (
    <div className="px-8 py-12 mx-auto" style={{ width: 'clamp(680px, 80vw, 880px)' }}>
      <header className="space-y-7">
        <div>
          <div className="text-caps tracking-caps text-ink-muted uppercase mb-3">better-review</div>
          <h1 className="text-display text-ink-primary">Review GitHub PRs locally</h1>
          <p className="mt-3 text-h2 text-ink-secondary font-normal">
            Paste a pull request to start a session.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (trimmed && !create.isPending) {
              create.mutate({ prInput: trimmed, agent: effectiveAgent })
            }
          }}
          className="space-y-4"
        >
          <div className="flex items-center gap-2.5 rounded-lg bg-raised border border-rule pl-3.5 pr-1.5 py-1.5 transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus-within:border-brand focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)]">
            <ChevronRight size={18} className="text-ink-muted shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
              className="flex-1 py-2 bg-transparent text-h2 text-ink-primary placeholder:text-ink-muted focus:outline-none"
              aria-label="PR target"
            />
            <Button type="submit" variant="ink" size="md" disabled={!trimmed || create.isPending}>
              {create.isPending ? 'Starting…' : 'Start review'}
            </Button>
          </div>

          <fieldset
            className="flex items-center gap-1.5 text-meta text-ink-secondary"
            aria-label="Review agent"
          >
            <legend className="text-caps tracking-caps text-ink-muted uppercase mr-1">Agent</legend>
            {AGENT_KINDS.map((k) => {
              const found = health?.agents[k].found ?? true
              const selected = effectiveAgent === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAgent(k)}
                  disabled={!found}
                  aria-pressed={selected}
                  title={found ? undefined : `${k} CLI not found in PATH`}
                  className={cn(
                    'h-7 px-2.5 rounded-sm border font-mono text-meta tabular-nums transition-colors duration-180 ease-out-quart',
                    selected
                      ? 'border-ink-primary bg-ink-primary text-canvas'
                      : 'border-rule bg-raised/25 text-ink-secondary hover:text-ink-primary hover:bg-raised hover:border-ink-muted',
                    !found && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  {k}
                  {health && k === health.defaultAgent ? (
                    <span
                      className={cn(
                        'ml-1.5 text-[10px]',
                        selected ? 'text-canvas/70' : 'text-ink-muted',
                      )}
                    >
                      default
                    </span>
                  ) : null}
                </button>
              )
            })}
          </fieldset>
        </form>

        {create.isError ? (
          <div className="text-meta text-severity-must">
            {create.error instanceof ApiError ? create.error.message : 'Failed to start review'}
          </div>
        ) : null}
      </header>

      <section className="mt-16">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-caps tracking-caps text-ink-muted uppercase">Recent</h2>
          {sessions.length > 3 ? (
            <span className="text-caps tracking-caps text-ink-muted uppercase">
              {sessions.length} total
            </span>
          ) : null}
        </div>
        {recent.length === 0 ? (
          <EmptyState
            eyebrow="No history"
            title="Nothing to recall yet"
            body="Sessions you start here will be available in the sidebar across browser restarts."
          />
        ) : (
          <div>
            {recent.map((s) => (
              <RecentRow key={s.id} session={s} />
            ))}
          </div>
        )}
      </section>

      <footer className="mt-12 border-t border-rule pt-4 flex items-center gap-3 text-meta text-ink-muted">
        <KbdHint keys={['⏎']} label="start review" />
        <span>·</span>
        <span>Configure default agent in</span>
        <Link
          to="/settings"
          className="text-ink-secondary hover:text-brand underline-offset-4 hover:underline"
        >
          settings
        </Link>
      </footer>
    </div>
  )
}
