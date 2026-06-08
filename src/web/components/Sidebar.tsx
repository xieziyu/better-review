import type { PRSession, SessionStatus } from '@shared/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router-dom'

import { EmptyState } from '@/components/ui'
import { api, queryKeys } from '@/lib/api'
import { useRelativeTime } from '@/lib/format'
import { sessionDisplayLabel } from '@/lib/session-display'
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

// Recency buckets for the flat session stream. Sessions are sorted by
// updatedAt desc and split into these calendar-relative windows so the
// most-recently-touched review is always near the top — independent of its
// type (PR vs local) or status. Browsing by repo/PR/status is handled by
// the search box + status chips, not by structural grouping.
type BucketKey = 'today' | 'yesterday' | 'week' | 'older'
const BUCKET_ORDER: BucketKey[] = ['today', 'yesterday', 'week', 'older']

interface RecencyBounds {
  today: number
  yesterday: number
  week: number
}

// Calendar-day boundaries for the recency buckets, computed via the Date
// constructor (not fixed-ms subtraction) so each lands on a true *local*
// midnight and stays correct across DST transitions, where a day is not 24h.
// `week` is a rolling window of the last 7 calendar days, deliberately *not*
// a Monday-anchored calendar week: a calendar week would empty this bucket
// early in the week (a Friday review would drop to "Older" by Monday), which
// defeats the point of a recency-first list.
function recencyBounds(now: Date): RecencyBounds {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  return {
    today: new Date(y, m, d).getTime(),
    yesterday: new Date(y, m, d - 1).getTime(),
    week: new Date(y, m, d - 6).getTime(),
  }
}

// Classify an updatedAt timestamp into a recency bucket relative to `now`.
function bucketOf(updatedAt: number, b: RecencyBounds): BucketKey {
  if (updatedAt >= b.today) return 'today'
  if (updatedAt >= b.yesterday) return 'yesterday'
  if (updatedAt >= b.week) return 'week'
  return 'older'
}

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
const COLLAPSED_KEY = 'better-review:sidebar-collapsed:v1'
const RAIL_WIDTH = 48

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(COLLAPSED_KEY) === '1'
}

function writeCollapsed(value: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
}

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
  if (
    session.source.kind === 'github-pr' &&
    /^\d+$/.test(numericQuery) &&
    String(session.number).includes(numericQuery)
  ) {
    return true
  }
  const haystacks: string[] = [session.title ?? '', session.author ?? '']
  if (session.source.kind === 'github-pr') {
    haystacks.push(
      session.owner,
      session.repo,
      `${session.owner}/${session.repo}`,
      `${session.owner}/${session.repo}#${session.number}`,
    )
  } else if (session.source.kind === 'local-branch') {
    haystacks.push(
      session.source.repoPath,
      session.source.head,
      session.headRef ?? '',
      sessionDisplayLabel(session),
    )
  } else if (session.source.kind === 'gitbutler-vbranch') {
    haystacks.push(
      session.source.repoPath,
      session.source.vbranchName,
      sessionDisplayLabel(session),
    )
  }
  return haystacks.some((h) => h.toLowerCase().includes(q))
}

// A one-glyph type marker shown before the identity label. With the PR/Local
// sections gone, this is what distinguishes a GitHub PR (`#`) from a local
// branch / GitButler vbranch (`⎇`) at a glance.
function sourceGlyph(session: PRSession): string {
  return session.source.kind === 'github-pr' ? '#' : '⎇'
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
      to={`/session/${session.id}`}
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
        className="mt-1.5 flex items-center gap-1.5 font-mono text-meta text-ink-secondary tabular-nums min-w-0"
        title={sessionDisplayLabel(session)}
      >
        <span aria-hidden="true" className="shrink-0 text-ink-muted">
          {sourceGlyph(session)}
        </span>
        <span className="truncate">{sessionDisplayLabel(session)}</span>
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

// One recency bucket (Today / Yesterday / …) and its rows. The list is a
// single flat stream split only by these time windows.
function BucketGroup({
  label,
  count,
  children,
}: {
  label: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="pt-3 first:pt-2">
      <h2 className="flex items-center gap-2 px-5 pb-1.5 pt-1">
        <span className="text-caps tracking-caps text-ink-muted uppercase truncate">{label}</span>
        <span className="font-mono text-meta text-ink-muted tabular-nums">{count}</span>
        <span aria-hidden="true" className="flex-1 h-px bg-rule" />
      </h2>
      <div>{children}</div>
    </section>
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

interface SidebarRailProps {
  runningCount: number
  onExpandFocusSearch: () => void
}

function SidebarRail({ runningCount, onExpandFocusSearch }: SidebarRailProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-1.5 py-3">
      <Link
        to="/"
        aria-label={t('sidebar.newReviewAria')}
        title={t('sidebar.newReview')}
        className="inline-flex items-center justify-center size-8 rounded-md border border-[color:var(--btn-primary-border)] bg-[color:var(--btn-primary-bg)] text-[color:var(--btn-primary-ink)] hover:bg-[color:color-mix(in_oklch,var(--btn-primary-bg)_85%,var(--btn-primary-border))] transition-colors duration-180 ease-out-quart"
      >
        <Plus size={15} strokeWidth={2.5} aria-hidden="true" />
      </Link>
      <button
        type="button"
        onClick={onExpandFocusSearch}
        aria-label={t('sidebar.searchExpandAria')}
        title={t('sidebar.search.ariaLabel')}
        className="inline-flex items-center justify-center size-8 rounded-md text-ink-secondary hover:text-ink-primary hover:bg-canvas/60 transition-colors duration-180 ease-out-quart"
      >
        <Search size={15} aria-hidden="true" />
      </button>
      <div className="flex-1" />
      {runningCount > 0 ? (
        <div
          aria-label={t('sidebar.runningBadgeAria', { count: runningCount })}
          title={t('sidebar.runningBadgeAria', { count: runningCount })}
          className="inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-canvas border border-rule font-mono text-[10px] tabular-nums text-accent-active"
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-accent-active animate-running-pulse"
          />
          <span>{runningCount}</span>
        </div>
      ) : null}
    </div>
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
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed())
  // Set when the user triggers an expand-and-focus action (rail search button
  // or ⌘K while collapsed). The effect below focuses the input once it's in
  // the tree after the collapsed→expanded transition.
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      writeCollapsed(next)
      return next
    })
  }, [])

  const expandAndFocusSearch = useCallback(() => {
    setCollapsed(false)
    writeCollapsed(false)
    setPendingSearchFocus(true)
  }, [])

  useEffect(() => {
    if (collapsed || !pendingSearchFocus) return
    const el = searchRef.current
    if (!el) return
    el.focus()
    el.select()
    setPendingSearchFocus(false)
  }, [collapsed, pendingSearchFocus])

  // ⌘K / Ctrl+K focuses the search input. When the sidebar is collapsed, it
  // first expands and then focuses on the next render.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'k' && e.key !== 'K') return
      if (!(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      if (collapsed) {
        expandAndFocusSearch()
        return
      }
      const el = searchRef.current
      if (!el) return
      el.focus()
      el.select()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [collapsed, expandAndFocusSearch])

  const groupCounts = useMemo(() => {
    const counts: Record<GroupKey, number> = { active: 0, done: 0, stale: 0 }
    for (const s of sessions) counts[GROUP_OF[s.status]] += 1
    return counts
  }, [sessions])

  // Rail badge only highlights actively running agents (not pending prep),
  // so a non-zero count means "something is producing findings right now."
  const runningCount = useMemo(
    () => sessions.filter((s) => s.status === 'running').length,
    [sessions],
  )

  // If the user has toggled every chip off, treat it as "no filter" rather
  // than rendering an empty list — the chips become a quick subset selector,
  // not a way to nuke the sidebar.
  const effectiveFilter = filter.size === 0 ? ALL_GROUPS : filter

  // Flat recency stream: filter by the active status chips + search, then sort
  // by updatedAt desc and split into calendar-relative buckets. The most-
  // recently-touched review floats to the top regardless of type or status;
  // repo/PR/status browsing is delegated to search + chips.
  const buckets = useMemo(() => {
    const filtered = sessions.filter(
      (s) => effectiveFilter.has(GROUP_OF[s.status]) && matchesSearch(s, query),
    )
    filtered.sort((a, b) => b.updatedAt - a.updatedAt)
    const bounds = recencyBounds(new Date())
    const byBucket = new Map<BucketKey, PRSession[]>()
    for (const s of filtered) {
      const b = bucketOf(s.updatedAt, bounds)
      const arr = byBucket.get(b) ?? []
      arr.push(s)
      byBucket.set(b, arr)
    }
    return { byBucket, count: filtered.length }
  }, [sessions, effectiveFilter, query])

  const visibleCount = buckets.count

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

  const collapseLabel = collapsed ? t('sidebar.expandAria') : t('sidebar.collapseAria')

  return (
    <aside
      style={{ width: collapsed ? RAIL_WIDTH : width }}
      className="relative shrink-0 border-r border-rule bg-raised flex flex-col min-h-0 z-10"
    >
      {collapsed ? (
        <SidebarRail runningCount={runningCount} onExpandFocusSearch={expandAndFocusSearch} />
      ) : (
        <>
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
                {BUCKET_ORDER.map((b) => {
                  const items = buckets.byBucket.get(b)
                  if (!items || items.length === 0) return null
                  return (
                    <BucketGroup key={b} label={t(`sidebar.bucket.${b}`)} count={items.length}>
                      {items.map((s) => (
                        <SessionRow key={s.id} session={s} />
                      ))}
                    </BucketGroup>
                  )
                })}
              </div>
            )}
          </nav>
        </>
      )}

      {/* Draggable resize strip — only when expanded; the rail is a fixed width. */}
      {!collapsed ? (
        <div
          {...separatorProps}
          className={cn(
            'absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none',
            'transition-colors duration-180 ease-out-quart',
            isDragging ? 'bg-brand' : 'hover:bg-brand/30',
          )}
        />
      ) : null}

      {/* Chevron toggle: a small tab anchored to the sidebar/canvas boundary at a
          fixed Y. Y stays put across collapse/expand so the affordance is
          spatially stable; only X follows the panel width. stopPropagation
          keeps the click from initiating a drag on the separator beneath. */}
      <button
        type="button"
        onClick={toggleCollapsed}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={collapseLabel}
        aria-pressed={collapsed}
        title={collapseLabel}
        className={cn(
          'absolute top-[60px] right-0 translate-x-1/2 z-20',
          'inline-flex items-center justify-center w-4 h-7 rounded-md',
          'border border-rule bg-raised text-ink-muted shadow-sm',
          'hover:text-ink-primary hover:bg-canvas hover:border-ink-muted',
          'transition-colors duration-180 ease-out-quart',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        )}
      >
        {collapsed ? (
          <ChevronRight size={12} aria-hidden="true" />
        ) : (
          <ChevronLeft size={12} aria-hidden="true" />
        )}
      </button>
    </aside>
  )
}
