import type { PRSession, SessionStatus } from '@shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { EmptyState } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'
import { useRelativeTime } from '@/lib/format'
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

const STATUS_TONE: Record<SessionStatus, string> = {
  running: 'text-accent-running',
  pending: 'text-severity-should',
  ready: 'text-accent-ready',
  submitted: 'text-ink-muted',
  failed: 'text-severity-must',
  cancelled: 'text-ink-muted',
  archived: 'text-ink-muted',
}

const CLOSED_STATUSES: ReadonlySet<SessionStatus> = new Set(['submitted', 'archived', 'cancelled'])

const SIDEBAR_MIN = 256
const SIDEBAR_MAX = 560
const SIDEBAR_DEFAULT = 280
const SIDEBAR_KEY = 'better-review:sidebar-width:v2'

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

function NewReviewLink() {
  const { t } = useTranslation()
  return (
    <NavLink
      to="/"
      end
      aria-label={t('sidebar.newReviewAria')}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 px-5 py-3 border-b border-rule text-caps tracking-caps uppercase transition-colors duration-180 ease-out-quart',
          isActive
            ? 'text-ink-primary bg-canvas'
            : 'text-ink-secondary hover:text-ink-primary hover:bg-canvas/50',
        )
      }
    >
      <Plus size={14} aria-hidden="true" />
      <span>{t('sidebar.newReview')}</span>
    </NavLink>
  )
}

interface SessionRowProps {
  session: PRSession
}

function SessionRow({ session }: SessionRowProps) {
  const { t } = useTranslation()
  const relativeTime = useRelativeTime()
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
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0 top-2 bottom-2 w-px',
          session.status === 'running'
            ? 'bg-accent-running animate-running-pulse'
            : 'bg-transparent',
        )}
      />
      <h3 className={cn('text-h2 line-clamp-2', closed ? 'text-ink-secondary' : 'text-ink-primary')}>
        {session.title ?? t('sidebar.noTitle')}
      </h3>
      <div
        className="mt-1.5 font-mono text-meta text-ink-secondary tabular-nums truncate"
        title={`${session.owner}/${session.repo}#${session.number}`}
      >
        {session.owner}/{session.repo}#{session.number}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5 text-meta min-w-0">
        <span
          className={cn(
            'text-caps tracking-caps uppercase shrink-0',
            STATUS_TONE[session.status],
          )}
          data-status={session.status}
        >
          {t(`sidebar.status.${session.status}`)}
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
    </NavLink>
  )
}

export function Sidebar() {
  const { t } = useTranslation()
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
        e.key === 'ArrowLeft' ? Math.max(w - step, SIDEBAR_MIN) : Math.min(w + step, SIDEBAR_MAX)
      persistWidth(next)
      return next
    })
  }

  return (
    <aside
      style={{ width }}
      className="relative shrink-0 border-r border-rule bg-raised flex flex-col min-h-0"
    >
      <NewReviewLink />
      <nav className="flex-1 overflow-y-auto" aria-label={t('sidebar.sessionsAria')}>
        {sessions.length === 0 ? (
          <div className="px-5 py-8">
            <EmptyState
              eyebrow={t('sidebar.emptyEyebrow')}
              title={t('sidebar.emptyTitle')}
              body={t('sidebar.emptyBody')}
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
                      {t(`sidebar.group.${g}`)}
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
        aria-label={t('sidebar.resizeAria')}
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
