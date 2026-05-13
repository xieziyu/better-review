import type { AgentKind, PRSession } from '@shared/types'
import { AGENT_KINDS } from '@shared/types'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, FileText, FolderGit2, FolderOpen, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Button, EmptyState, KbdHint, Tag } from '@/components/ui'
import { api, queryKeys, ApiError } from '@/lib/api'
import { useRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const PR_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
function parsePrTarget(input: string): { owner: string; repo: string } | null {
  const m = PR_URL_RE.exec(input.trim())
  if (!m) return null
  return { owner: m[1]!, repo: m[2]! }
}

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

function RecentRow({ session }: { session: PRSession }) {
  const { t } = useTranslation()
  const relativeTime = useRelativeTime()
  return (
    <Link
      to={`/pr/${session.id}`}
      className="group block py-3 border-b border-rule last:border-b-0"
    >
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-meta text-ink-secondary tabular-nums">
          {session.owner}/{session.repo}#{session.number}
        </span>
        <Tag tone={STATUS_TONE[session.status]}>{t(`sidebar.status.${session.status}`)}</Tag>
        <span className="ml-auto text-caps tracking-caps text-ink-muted uppercase">
          {relativeTime(session.updatedAt)}
        </span>
      </div>
      <div className="mt-1 text-h2 text-ink-primary group-hover:text-brand transition-colors duration-180 ease-out-quart">
        {session.title ?? t('home.recent.noTitle')}
      </div>
      {session.author ? (
        <div className="mt-0.5 font-mono text-meta text-ink-muted">@{session.author}</div>
      ) : null}
    </Link>
  )
}

export function Home() {
  const { t } = useTranslation()
  const relativeTime = useRelativeTime()
  const [input, setInput] = useState('')
  const [localRepo, setLocalRepo] = useState('')
  const [localRepoTouched, setLocalRepoTouched] = useState(false)
  const [autoFilledFor, setAutoFilledFor] = useState<string | null>(null)
  const [agent, setAgent] = useState<AgentKind | null>(null)
  const [extraPrompt, setExtraPrompt] = useState('')
  const [extraOpen, setExtraOpen] = useState(false)
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
  const target = useMemo(() => parsePrTarget(trimmed), [trimmed])
  const { data: recentRepos } = useQuery({
    queryKey: queryKeys.recentRepos(target?.owner ?? '', target?.repo ?? ''),
    queryFn: () =>
      api.recentRepos(
        target ? { owner: target.owner, repo: target.repo, limit: 10 } : { limit: 10 },
      ),
  })

  // Auto-fill the local-repo field when the user pastes a PR URL whose
  // owner/repo matches exactly one previously-used local path. Don't clobber
  // a value the user has typed (`localRepoTouched`) or one we already filled
  // for this same target (`autoFilledFor`).
  useEffect(() => {
    if (localRepoTouched) return
    if (!target) return
    const key = `${target.owner}/${target.repo}`
    if (autoFilledFor === key) return
    const matches = recentRepos?.items.filter((r) => r.matchedCurrentRepo) ?? []
    if (matches.length === 1) {
      setLocalRepo(matches[0]!.path)
      setAutoFilledFor(key)
    }
  }, [recentRepos, target, localRepoTouched, autoFilledFor])

  const recent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3)
  const effectiveAgent = agent ?? health?.defaultAgent ?? 'claude'
  const showAutoFillHint =
    !localRepoTouched && target && autoFilledFor === `${target.owner}/${target.repo}`
  const folderPickerSupported = health?.fs?.folderPicker?.supported ?? false
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerBusy, setPickerBusy] = useState(false)

  async function browseLocalRepo(): Promise<void> {
    setPickerError(null)
    setPickerBusy(true)
    try {
      const r = await api.pickDirectory('Select repository for review')
      if (r.path) {
        setLocalRepo(r.path)
        setLocalRepoTouched(true)
      }
    } catch (e) {
      setPickerError(e instanceof ApiError ? e.message : t('home.pickerError'))
    } finally {
      setPickerBusy(false)
    }
  }

  return (
    <div className="px-8 py-12 mx-auto" style={{ width: 'clamp(680px, 80vw, 880px)' }}>
      <header className="space-y-7">
        <div>
          <div className="text-caps tracking-caps text-ink-muted uppercase mb-3">
            {t('home.eyebrow')}
          </div>
          <h1 className="text-display text-ink-primary">{t('home.title')}</h1>
          <p className="mt-3 text-h2 text-ink-secondary font-normal">{t('home.subtitle')}</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (trimmed && !create.isPending) {
              const payload: Parameters<typeof create.mutate>[0] = {
                prInput: trimmed,
                agent: effectiveAgent,
              }
              const repo = localRepo.trim()
              if (repo) payload.localRepoPath = repo
              const extra = extraPrompt.trim()
              if (extra) payload.extraPrompt = extra
              create.mutate(payload)
            }
          }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2.5 rounded-lg bg-raised border border-rule pl-3.5 pr-1.5 py-1.5 transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus-within:border-brand focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)]">
            <ChevronRight size={18} className="text-ink-muted shrink-0" aria-hidden="true" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('home.prUrlPlaceholder')}
              className="flex-1 py-2 bg-transparent text-h2 text-ink-primary placeholder:text-ink-muted focus:outline-none"
              aria-label={t('home.prAriaLabel')}
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!trimmed || create.isPending}
            >
              {create.isPending ? t('home.starting') : t('home.startReview')}
            </Button>
          </div>

          <div className="flex items-center gap-2.5 rounded-lg bg-raised border border-rule pl-3.5 pr-3 py-1 transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus-within:border-brand focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)]">
            <FolderGit2 size={16} className="text-ink-muted shrink-0" aria-hidden="true" />
            <input
              type="text"
              list="recent-repos"
              value={localRepo}
              onChange={(e) => {
                setLocalRepo(e.target.value)
                setLocalRepoTouched(true)
              }}
              placeholder={t('home.localRepoPlaceholder')}
              className="flex-1 py-1.5 bg-transparent text-meta text-ink-primary placeholder:text-ink-muted focus:outline-none font-mono"
              aria-label={t('home.localRepoAriaLabel')}
              spellCheck={false}
              autoComplete="off"
            />
            {folderPickerSupported ? (
              <button
                type="button"
                onClick={browseLocalRepo}
                disabled={pickerBusy}
                className="flex items-center gap-1 px-2 py-1 rounded text-meta text-ink-secondary hover:text-ink-primary hover:bg-canvas transition-colors duration-180 ease-out-quart disabled:opacity-50 disabled:cursor-progress"
                aria-label={t('home.browseAriaLabel')}
                title={t('home.browseTitle')}
              >
                <FolderOpen size={14} aria-hidden="true" />
                {pickerBusy ? t('home.opening') : t('home.browse')}
              </button>
            ) : null}
            {localRepo ? (
              <button
                type="button"
                onClick={() => {
                  setLocalRepo('')
                  setLocalRepoTouched(true)
                }}
                className="text-meta text-ink-muted hover:text-ink-secondary transition-colors duration-180 ease-out-quart"
                aria-label={t('home.clearAriaLabel')}
              >
                {t('home.clear')}
              </button>
            ) : null}
          </div>
          {pickerError ? (
            <div className="text-meta text-severity-must -mt-1 pl-1">{pickerError}</div>
          ) : null}
          <datalist id="recent-repos">
            {recentRepos?.items.map((r) => (
              <option key={r.path} value={r.path}>
                {r.matchedCurrentRepo ? t('home.recentRepoMatch') : ''}
                {t('home.recentRepoMeta', {
                  when: relativeTime(r.lastUsedAt),
                  count: r.useCount,
                })}
              </option>
            ))}
          </datalist>
          {showAutoFillHint ? (
            <div className="text-meta text-ink-muted -mt-1 pl-1">
              {t('home.autoFillHint', { owner: target!.owner, repo: target!.repo })}
            </div>
          ) : null}

          {extraOpen ? (
            <div className="rounded-lg bg-raised border border-rule p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-caps tracking-caps text-ink-muted uppercase">
                  {t('home.extra.header')}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setExtraOpen(false)
                    setExtraPrompt('')
                  }}
                  className="inline-flex items-center gap-1 text-meta text-ink-muted hover:text-ink-secondary transition-colors duration-180 ease-out-quart"
                  aria-label={t('home.extra.removeAriaLabel')}
                >
                  <X size={12} aria-hidden="true" />
                  {t('home.extra.remove')}
                </button>
              </div>
              <textarea
                aria-label={t('home.extra.ariaLabel')}
                value={extraPrompt}
                onChange={(e) => setExtraPrompt(e.target.value)}
                placeholder={t('home.extra.placeholder')}
                className="w-full min-h-[8rem] p-3 font-mono text-code rounded-md bg-canvas border border-rule text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart resize-y"
                spellCheck={false}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setExtraOpen(true)}
              className="inline-flex items-center gap-1.5 text-meta text-ink-secondary hover:text-ink-primary transition-colors duration-180 ease-out-quart"
              aria-label={t('home.extra.addAriaLabel')}
            >
              <FileText size={14} aria-hidden="true" />
              <span>{t('home.extra.addLabel')}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          )}

          <fieldset
            className="flex items-center gap-1.5 text-meta text-ink-secondary"
            aria-label={t('home.agent.legend')}
          >
            <legend className="sr-only">{t('home.agent.legend')}</legend>
            <span className="mr-1 text-caps tracking-caps text-ink-muted uppercase">
              {t('home.agent.label')}
            </span>
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
                  title={found ? undefined : t('home.agent.notFoundTitle', { kind: k })}
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
                      {t('home.agent.defaultSuffix')}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </fieldset>
        </form>

        <div className="flex items-center gap-3 text-meta text-ink-muted pl-1">
          <KbdHint keys={['⏎']} label={t('home.footer.startReviewLabel')} />
          <span aria-hidden="true">·</span>
          <span>
            <Trans
              i18nKey="home.footer.configureLine"
              components={[
                <Link
                  key="settings"
                  to="/settings"
                  className="text-ink-secondary hover:text-brand underline-offset-4 hover:underline"
                />,
              ]}
            />
          </span>
        </div>

        {create.isError ? (
          <div className="text-meta text-severity-must">
            {create.error instanceof ApiError ? create.error.message : t('home.submitError')}
          </div>
        ) : null}
      </header>

      <section className="mt-16">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-caps tracking-caps text-ink-muted uppercase">
            {t('home.recent.title')}
          </h2>
          {sessions.length > 3 ? (
            <span className="text-caps tracking-caps text-ink-muted uppercase">
              {t('home.recent.total', { count: sessions.length })}
            </span>
          ) : null}
        </div>
        {recent.length === 0 ? (
          <EmptyState
            eyebrow={t('home.recent.emptyEyebrow')}
            title={t('home.recent.emptyTitle')}
            body={t('home.recent.emptyBody')}
          />
        ) : (
          <div>
            {recent.map((s) => (
              <RecentRow key={s.id} session={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
