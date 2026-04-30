import type { PRSession, SessionStatus } from '@shared/types'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  ready: 'text-brand',
  submitted: 'text-ink-muted',
  failed: 'text-severity-must',
  cancelled: 'text-ink-muted',
  archived: 'text-ink-muted',
}

const CLOSED_STATUSES: ReadonlySet<SessionStatus> = new Set([
  'submitted',
  'archived',
  'cancelled',
])

const SIDEBAR_MIN = 256
const SIDEBAR_MAX = 560
const SIDEBAR_DEFAULT = 320
const SIDEBAR_KEY = 'better-review:sidebar-width'

function readStoredWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT
  const raw = window.localStorage.getItem(SIDEBAR_KEY)
  const n = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(n)) return SIDEBAR_DEFAULT
  return Math.min(Math.max(n, SIDEBAR_MIN), SIDEBAR_MAX)
}

function persistWidth(w: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_KEY, String(w))
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
      className="px-5 pt-5 pb-4 border-b border-rule"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = value.trim()
        if (trimmed) create.mutate({ prInput: trimmed })
      }}
    >
      <label className="block text-caps tracking-caps text-ink-muted mb-2">New review</label>
      <div className="flex items-center gap-1.5 rounded-md bg-canvas border border-rule px-2.5 py-1 transition-[border-color,box-shadow] duration-180 ease-out-quart focus-within:border-brand focus-within:shadow-[0_0_0_2px_color-mix(in_oklch,var(--brand)_14%,transparent)]">
        <ChevronRight size={14} className="text-ink-muted shrink-0" aria-hidden="true" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste GitHub PR URL · press ⏎"
          aria-label="GitHub PR URL"
          className="w-full py-1 bg-transparent text-body text-ink-primary placeholder:text-ink-muted focus:outline-none"
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
  const closed = CLOSED_STATUSES.has(session.status)
  return (
    <NavLink
      to={`/pr/${session.id}`}
      className={({ isActive }) =>
        cn(
          'group relative block py-3 pl-5 pr-4 transition-colors duration-180 ease-out-quart',
          isActive ? 'bg-canvas' : 'hover:bg-canvas/50',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden="true"
            className={cn(
              'absolute left-0 top-2 bottom-2',
              isActive
                ? 'w-[2px] bg-brand'
                : session.status === 'running'
                  ? 'w-px bg-accent-running animate-running-pulse'
                  : 'w-px bg-transparent',
            )}
          />
          <h3
            className={cn(
              'text-h2 line-clamp-2',
              closed ? 'text-ink-secondary' : 'text-ink-primary',
            )}
          >
            {session.title ?? '(no title)'}
          </h3>
          <div className="mt-1.5 flex items-baseline gap-1.5 text-meta min-w-0">
            <span
              className={cn(
                'text-caps tracking-caps uppercase shrink-0',
                STATUS_TONE[session.status],
              )}
              data-status={session.status}
            >
              {STATUS_LABEL[session.status]}
            </span>
            <span aria-hidden="true" className="text-ink-muted shrink-0">
              ·
            </span>
            <span className="font-mono text-ink-secondary tabular-nums truncate min-w-0">
              {session.owner}/{session.repo}#{session.number}
            </span>
            {session.author ? (
              <>
                <span aria-hidden="true" className="text-ink-muted shrink-0">
                  ·
                </span>
                <span className="text-ink-muted shrink-0 truncate max-w-[12ch]">
                  @{session.author}
                </span>
              </>
            ) : null}
            <span aria-hidden="true" className="text-ink-muted shrink-0">
              ·
            </span>
            <span className="text-ink-muted shrink-0 tabular-nums">
              {relativeTime(session.updatedAt)}
            </span>
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

  const [width, setWidth] = useState<number>(() => readStoredWidth())
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const onSplitterPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startW: width }
    setIsDragging(true)
  }
  const onSplitterPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const next = Math.min(Math.max(drag.startW + dx, SIDEBAR_MIN), SIDEBAR_MAX)
    setWidth(next)
  }
  const onSplitterPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
    setIsDragging(false)
    persistWidth(width)
  }
  const onSplitterKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const step = e.shiftKey ? 32 : 8
    setWidth((w) => {
      const next =
        e.key === 'ArrowLeft'
          ? Math.max(w - step, SIDEBAR_MIN)
          : Math.min(w + step, SIDEBAR_MAX)
      persistWidth(next)
      return next
    })
  }

  return (
    <aside
      style={{ width }}
      className="relative shrink-0 border-r border-rule bg-raised flex flex-col min-h-0"
    >
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
                <section key={g} className="pt-5 first:pt-3">
                  <h3 className="flex items-center gap-2 px-5 pb-1.5">
                    <span className="text-caps tracking-caps text-ink-muted uppercase">
                      {GROUP_LABEL[g]}
                    </span>
                    <span className="font-mono text-meta text-ink-muted tabular-nums">
                      {items.length}
                    </span>
                    <span aria-hidden="true" className="flex-1 h-px bg-rule" />
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
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        tabIndex={0}
        onPointerDown={onSplitterPointerDown}
        onPointerMove={onSplitterPointerMove}
        onPointerUp={onSplitterPointerUp}
        onPointerCancel={onSplitterPointerUp}
        onKeyDown={onSplitterKeyDown}
        className={cn(
          'absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none',
          'transition-colors duration-180 ease-out-quart',
          isDragging ? 'bg-brand' : 'hover:bg-brand/30',
        )}
      />
    </aside>
  )
}
