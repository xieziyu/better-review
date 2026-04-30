import type { PRSession, SessionStatus } from '@shared/types'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { EmptyState } from '@/components/ui'
import { api, queryKeys, ApiError } from '@/lib/api'
import { useSSE } from '@/lib/sse'
import { cn } from '@/lib/utils'

type GroupKey = 'active' | 'done' | 'stale'

const GROUP_OF: Record<SessionStatus, GroupKey> = {
  running: 'active',
  pending: 'active',
  ready: 'done',
  submitted: 'done',
  failed: 'stale',
  cancelled: 'stale',
  archived: 'stale',
}

const GROUP_ORDER: GroupKey[] = ['active', 'done', 'stale']

const GROUP_LABEL: Record<GroupKey, string> = {
  active: 'Active',
  done: 'Done',
  stale: 'Stale',
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  running: 'Running',
  pending: 'Pending',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
  submitted: 'Submitted',
  archived: 'Archived',
}

const STATUS_TONE: Record<SessionStatus, string> = {
  running: 'text-accent-running',
  pending: 'text-severity-should',
  ready: 'text-ink-primary',
  submitted: 'text-ink-secondary',
  failed: 'text-severity-must',
  cancelled: 'text-ink-muted',
  archived: 'text-ink-muted',
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

function NewPRInput() {
  const [value, setValue] = useState('')
  const nav = useNavigate()
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: api.createSession,
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions })
      setValue('')
      nav(`/pr/${id}`)
    },
  })
  return (
    <form
      className="px-5 pt-5 pb-3 border-b border-rule"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = value.trim()
        if (trimmed) create.mutate({ prInput: trimmed })
      }}
    >
      <label className="block text-caps tracking-caps text-ink-muted mb-2">New review</label>
      <div className="flex items-center gap-1.5 border-b border-rule focus-within:border-brand transition-colors duration-180 ease-out-quart">
        <ChevronRight size={14} className="text-ink-muted shrink-0" aria-hidden="true" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste GitHub PR URL · press ⏎"
          aria-label="GitHub PR URL"
          className="w-full py-1.5 bg-transparent text-body text-ink-primary placeholder:text-ink-muted focus:outline-none"
          disabled={create.isPending}
        />
      </div>
      {create.isError ? (
        <div className="mt-2 text-caps tracking-caps text-severity-must uppercase">
          {create.error instanceof ApiError ? create.error.message : 'failed to create session'}
        </div>
      ) : null}
    </form>
  )
}

interface SessionRowProps {
  session: PRSession
}

function SessionRow({ session }: SessionRowProps) {
  return (
    <NavLink
      to={`/pr/${session.id}`}
      className={({ isActive }) =>
        cn(
          'group relative block py-2.5 pl-4 pr-3 transition-colors duration-180 ease-out-quart',
          isActive ? 'bg-canvas' : 'hover:bg-canvas/60',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-y-1 left-0 w-px',
              session.status === 'running'
                ? 'bg-accent-running animate-running-pulse'
                : isActive
                  ? 'bg-brand'
                  : 'bg-rule',
            )}
          />
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-meta text-ink-secondary tabular-nums truncate">
              {session.owner}/{session.repo}#{session.number}
            </span>
            <span
              className={cn(
                'ml-auto text-caps tracking-caps uppercase shrink-0',
                STATUS_TONE[session.status],
              )}
              data-status={session.status}
            >
              {STATUS_LABEL[session.status]}
            </span>
          </div>
          <div className="mt-1 text-body text-ink-primary line-clamp-2">
            {session.title ?? '(no title)'}
          </div>
          <div className="mt-1 text-caps tracking-caps text-ink-muted">
            {session.author ? `${session.author} · ` : ''}
            {relativeTime(session.updatedAt)}
          </div>
        </>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  const qc = useQueryClient()
  const { data: sessions = [] } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: api.listSessions,
  })
  useSSE('/api/events', (e) => {
    if (
      e.type === 'status-changed' ||
      e.type === 'done' ||
      e.type === 'error' ||
      e.type === 'finding-added' ||
      e.type === 'finding-updated'
    ) {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions })
    }
  })

  const grouped = new Map<GroupKey, PRSession[]>()
  for (const s of sessions) {
    const g = GROUP_OF[s.status]
    const arr = grouped.get(g) ?? []
    arr.push(s)
    grouped.set(g, arr)
  }
  for (const arr of grouped.values()) arr.sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <aside className="w-80 shrink-0 border-r border-rule bg-raised flex flex-col min-h-0">
      <NewPRInput />
      <nav className="flex-1 overflow-y-auto" aria-label="Sessions">
        {sessions.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              eyebrow="No sessions"
              title="Paste a PR to begin"
              body="The agent runs locally; this list shows everything in flight, done, or stale."
            />
          </div>
        ) : (
          <div className="pb-6">
            {GROUP_ORDER.map((g) => {
              const items = grouped.get(g)
              if (!items || items.length === 0) return null
              return (
                <section key={g} className="pt-4">
                  <h3 className="px-5 pb-1 text-caps tracking-caps text-ink-muted uppercase">
                    {GROUP_LABEL[g]} · {items.length}
                  </h3>
                  <div>
                    {items.map((s) => (
                      <SessionRow key={s.id} session={s} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </nav>
    </aside>
  )
}
