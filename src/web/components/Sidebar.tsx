import type { PRSession, SessionStatus } from '@shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router-dom'

import { EmptyState } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'
import { useRelativeTime } from '@/lib/format'
import { useSSE } from '@/lib/sse'
import { useResizable } from '@/lib/use-resizable'
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
const ALL_GROUPS = new Set<GroupKey>(GROUP_ORDER)

const STATUS_TONE: Record<SessionStatus, string> = {
  running: 'text-accent-active',
  pending: 'text-severity-should',
  ready: 'text-accent-ready',
  submitted: 'text-ink-muted',
  failed: 'text-severity-must',
  cancelled: 'text-ink-muted',
  archived: 'text-ink-muted',
}

// The "dot" on each filter chip — picks a representative status color so the
// chip carries the same signal language as the row status pill.
const GROUP_DOT: Record<GroupKey, string> = {
  active: 'bg-accent-active',
  done: 'bg-accent-ready',
  stale: 'bg-ink-muted',
}

const CLOSED_STATUSES: ReadonlySet<SessionStatus> = new Set(['submitted', 'archived', 'cancelled'])

const SIDEBAR_MIN = 256
const SIDEBAR_MAX = 560
const SIDEBAR_DEFAULT = 300
const SIDEBAR_KEY = 'better-review:sidebar-width:v2'
const FILTER_KEY = 'better-review:sidebar-filter:v1'

function readFilter(): Set<GroupKey> {
  if (typeof window === 'undefined') return new Set(ALL_GROUPS)
  const raw = window.localStorage.getItem(FILTER_KEY)
  if (!raw) return new Set(ALL_GROUPS)
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is GroupKey => s === 'active' || s === 'done' || s === 'stale')
  if (parts.length === 0) return new Set(ALL_GROUPS)
  return new Set(parts)
}

function writeFilter(set: Set<GroupKey>): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FILTER_KEY, [...set].join(','))
}

// Substring match across the user-visible identifiers. Numeric input (with or
// without a leading "#") also matches the PR number alone, so "412" finds
// "acme/web#412".
export function matchesSearch(session: PRSession, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const numericQuery = q.replace(/^#/, '')
  if (/^\d+$/.test(numericQuery) && String(session.number).includes(numericQuery)) return true
  const haystacks = [
    session.title ?? '',
    session.owner,
    session.repo,
    `${session.owner}/${session.repo}`,
    `${session.owner}/${session.repo}#${session.number}`,
    session.author ?? '',
  ]
  return haystacks.some((h) => h.toLowerCase().includes(q))
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
            ? 'bg-accent-active animate-running-pulse'
            : 'bg-transparent',
        )}
      />
      <h3
        className={cn('text-h2 line-clamp-2', closed ? 'text-ink-secondary' : 'text-ink-primary')}
      >
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
          className={cn('text-caps tracking-caps uppercase shrink-0', STATUS_TONE[session.status])}
          data-status={session.status}
        >
          {t(`sidebar.status.${session.status}`)}
        </span>
        {session.author ? (
          <>
            <span aria-hidden="true" className="text-ink-muted shrink-0">
              ·
            </span>
            <span className="text-ink-muted shrink-0 truncate max-w-[12ch]">@{session.author}</span>
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

interface FilterChipProps {
  group: GroupKey
  count: number
  active: boolean
  onToggle: (g: GroupKey) => void
}

function FilterChip({ group, count, active, onToggle }: FilterChipProps) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={() => onToggle(group)}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 h-6 px-2 rounded-full border transition-colors duration-180 ease-out-quart text-caps tracking-caps uppercase',
        active
          ? 'bg-ink-primary text-canvas border-ink-primary'
          : 'bg-canvas text-ink-secondary border-rule hover:border-ink-muted hover:text-ink-primary',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('w-1.5 h-1.5 rounded-full', active ? GROUP_DOT[group] : 'bg-ink-muted/60')}
      />
      <span>{t(`sidebar.group.${group}`)}</span>
      <span
        className={cn(
          'font-mono text-[10px] tabular-nums font-semibold',
          active ? 'text-canvas/70' : 'text-ink-muted',
        )}
      >
        {count}
      </span>
    </button>
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

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Set<GroupKey>>(() => readFilter())
  const searchRef = useRef<HTMLInputElement | null>(null)

  // ⌘K / Ctrl+K focuses the search input. Skip when the user is already
  // typing in a different input so we don't hijack form fields elsewhere.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'k' && e.key !== 'K') return
      if (!(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      const el = searchRef.current
      if (!el) return
      el.focus()
      el.select()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const groupCounts = useMemo(() => {
    const counts: Record<GroupKey, number> = { active: 0, done: 0, stale: 0 }
    for (const s of sessions) counts[GROUP_OF[s.status]] += 1
    return counts
  }, [sessions])

  // If the user has toggled every chip off, treat it as "no filter" rather
  // than rendering an empty list — the chips become a quick subset selector,
  // not a way to nuke the sidebar.
  const effectiveFilter = filter.size === 0 ? ALL_GROUPS : filter

  const visible = useMemo(() => {
    const grouped = new Map<GroupKey, PRSession[]>()
    for (const s of sessions) {
      const g = GROUP_OF[s.status]
      if (!effectiveFilter.has(g)) continue
      if (!matchesSearch(s, query)) continue
      const arr = grouped.get(g) ?? []
      arr.push(s)
      grouped.set(g, arr)
    }
    for (const arr of grouped.values()) arr.sort((a, b) => b.updatedAt - a.updatedAt)
    return grouped
  }, [sessions, effectiveFilter, query])

  const visibleCount = useMemo(() => {
    let n = 0
    for (const arr of visible.values()) n += arr.length
    return n
  }, [visible])

  const toggleFilter = useCallback((g: GroupKey) => {
    setFilter((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      writeFilter(next)
      return next
    })
  }, [])

  const clearSearch = useCallback(() => {
    setQuery('')
    searchRef.current?.focus()
  }, [])

  const {
    size: width,
    isDragging,
    separatorProps,
  } = useResizable({
    defaultSize: SIDEBAR_DEFAULT,
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
    storageKey: SIDEBAR_KEY,
    edge: 'right',
    ariaLabel: t('sidebar.resizeAria'),
  })

  const hasSessions = sessions.length > 0
  const hasVisible = visibleCount > 0

  return (
    <aside
      style={{ width }}
      className="relative shrink-0 border-r border-rule bg-raised flex flex-col min-h-0"
    >
      <div className="px-4 pt-3 pb-2.5 border-b border-rule space-y-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-caps tracking-caps text-ink-muted uppercase shrink-0">
            {t('sidebar.eyebrow')}
          </span>
          <span
            className="font-mono text-meta text-ink-muted tabular-nums truncate"
            aria-live="polite"
          >
            {t('sidebar.total', { count: sessions.length })}
          </span>
          <Link
            to="/"
            aria-label={t('sidebar.newReviewAria')}
            title={t('sidebar.newReview')}
            className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-[color:var(--btn-primary-border)] bg-[color:var(--btn-primary-bg)] text-[color:var(--btn-primary-ink)] text-meta font-semibold hover:bg-[color:color-mix(in_oklch,var(--btn-primary-bg)_85%,var(--btn-primary-border))] transition-colors duration-180 ease-out-quart"
          >
            <Plus size={13} aria-hidden="true" strokeWidth={2.5} />
            <span>{t('sidebar.newReview')}</span>
          </Link>
        </div>

        <label className="flex items-center gap-1.5 h-7 px-2 rounded-md border border-rule bg-canvas focus-within:border-brand focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)] transition-[border-color,box-shadow] duration-180 ease-out-quart">
          <Search size={13} className="text-ink-muted shrink-0" aria-hidden="true" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sidebar.search.placeholder')}
            aria-label={t('sidebar.search.ariaLabel')}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent text-meta text-ink-primary placeholder:text-ink-muted focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={clearSearch}
              aria-label={t('sidebar.search.clearAriaLabel')}
              className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded text-ink-muted hover:text-ink-primary transition-colors duration-180 ease-out-quart"
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : (
            <kbd
              aria-hidden="true"
              className="shrink-0 font-mono text-[10px] text-ink-muted bg-raised border border-rule rounded px-1 py-px"
            >
              {t('sidebar.search.kbd')}
            </kbd>
          )}
        </label>

        <div
          role="group"
          aria-label={t('sidebar.filter.ariaLabel')}
          className="flex flex-wrap gap-1.5"
        >
          {GROUP_ORDER.map((g) => (
            <FilterChip
              key={g}
              group={g}
              count={groupCounts[g]}
              active={filter.has(g)}
              onToggle={toggleFilter}
            />
          ))}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto" aria-label={t('sidebar.sessionsAria')}>
        {!hasSessions ? (
          <div className="px-5 py-8">
            <EmptyState
              eyebrow={t('sidebar.emptyEyebrow')}
              title={t('sidebar.emptyTitle')}
              body={t('sidebar.emptyBody')}
            />
          </div>
        ) : !hasVisible ? (
          <div className="px-5 py-8">
            <EmptyState
              eyebrow={t('sidebar.noMatchEyebrow')}
              title={t('sidebar.noMatchTitle')}
              body={t('sidebar.noMatchBody')}
            />
          </div>
        ) : (
          <div className="pb-6">
            {GROUP_ORDER.map((g) => {
              const items = visible.get(g)
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
        {...separatorProps}
        className={cn(
          'absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none',
          'transition-colors duration-180 ease-out-quart',
          isDragging ? 'bg-brand' : 'hover:bg-brand/30',
        )}
      />
    </aside>
  )
}
