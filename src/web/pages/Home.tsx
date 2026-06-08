import type { AgentKind, PRSession } from '@shared/types'
import { AGENT_KINDS } from '@shared/types'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderGit2,
  FolderOpen,
  GitBranch,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import {
  Button,
  Combobox,
  EmptyState,
  KbdHint,
  SelectMenu,
  SelectMenuCheck,
  Tag,
} from '@/components/ui'
import { api, queryKeys, ApiError } from '@/lib/api'
import { useRelativeTime } from '@/lib/format'
import { sessionDisplayLabel } from '@/lib/session-display'
import { cn } from '@/lib/utils'

type HomeTab = 'pr' | 'local' | 'vbranch'

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
      to={`/session/${session.id}`}
      className="group block py-3 border-b border-rule last:border-b-0"
    >
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-meta text-ink-secondary tabular-nums">
          {sessionDisplayLabel(session)}
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

function TopTabButton({
  active,
  disabled,
  onClick,
  label,
  hint,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        'relative px-3 py-2 text-meta font-medium flex items-center gap-1.5 transition-colors duration-180 ease-out-quart',
        disabled
          ? 'text-ink-muted cursor-not-allowed'
          : active
            ? 'text-ink-primary'
            : 'text-ink-secondary hover:text-ink-primary',
      )}
    >
      {label}
      {hint ? (
        <span className="font-mono text-[10px] text-ink-muted border border-rule rounded px-1 py-px">
          {hint}
        </span>
      ) : null}
      {active ? (
        <span aria-hidden="true" className="absolute left-0 right-0 -bottom-px h-[2px] bg-brand" />
      ) : null}
    </button>
  )
}

export function Home() {
  const { t } = useTranslation()
  const relativeTime = useRelativeTime()
  const [tab, setTab] = useState<HomeTab>('pr')
  // PR tab state.
  const [input, setInput] = useState('')
  const [localRepo, setLocalRepo] = useState('')
  const [localRepoTouched, setLocalRepoTouched] = useState(false)
  const [autoFilledFor, setAutoFilledFor] = useState<string | null>(null)
  // Local-branch tab state. The repo input is intentionally independent from
  // the vbranch tab's repo (no shared default) — picking a repo in one tab
  // must never leak into the other.
  const [localTabRepo, setLocalTabRepo] = useState('')
  const [localTabHead, setLocalTabHead] = useState('')
  const [localTabBase, setLocalTabBase] = useState('')
  // Gate the auto-prefill of HEAD: once the user has touched it (typed,
  // picked, or cleared), don't clobber their choice when the branch list
  // refreshes.
  const [localTabHeadTouched, setLocalTabHeadTouched] = useState(false)
  // vbranch tab state. Repo + selected vbranch; inspect result is fetched
  // from the API and drives both the gating and the dropdown contents.
  const [vbranchTabRepo, setVbranchTabRepo] = useState('')
  const [vbranchSelected, setVbranchSelected] = useState<string>('')
  // Shared state.
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
      nav(`/session/${id}`)
    },
  })

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
  // Fallback chain when the user hasn't explicitly clicked an agent button:
  // configured default if it's installed → first installed in AGENT_KINDS
  // order → configured default as a last resort (keeps the disabled-default
  // UX intact when nothing is installed). Without this, a stale config that
  // pins an uninstalled agent would leave the new-session form unusable.
  const effectiveAgent: AgentKind =
    agent ??
    (health
      ? health.agents[health.defaultAgent].found
        ? health.defaultAgent
        : (AGENT_KINDS.find((k) => health.agents[k].found) ?? health.defaultAgent)
      : 'codex')
  const showAutoFillHint =
    !localRepoTouched && target && autoFilledFor === `${target.owner}/${target.repo}`
  const folderPickerSupported = health?.fs?.folderPicker?.supported ?? false
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerBusy, setPickerBusy] = useState<null | 'pr' | 'local' | 'vbranch'>(null)

  async function browseLocalRepo(into: 'pr' | 'local' | 'vbranch'): Promise<void> {
    setPickerError(null)
    setPickerBusy(into)
    try {
      const r = await api.pickDirectory(
        into === 'pr'
          ? 'Select repository for review'
          : into === 'local'
            ? 'Select local repository to review'
            : 'Select GitButler project',
      )
      if (r.path) {
        if (into === 'pr') {
          setLocalRepo(r.path)
          setLocalRepoTouched(true)
        } else if (into === 'local') {
          setLocalTabRepo(r.path)
        } else {
          setVbranchTabRepo(r.path)
        }
      }
    } catch (e) {
      setPickerError(e instanceof ApiError ? e.message : t('home.pickerError'))
    } finally {
      setPickerBusy(null)
    }
  }

  const localTabRepoTrim = localTabRepo.trim()
  const localTabCanSubmit = localTabRepoTrim.length > 0 && !create.isPending
  // Fetch local branches once the user has picked a repo on the local tab.
  // Mirrors the vbranchInspect pattern: parent query, both Combobox
  // pickers consume the same data.
  const { data: localBranches } = useQuery({
    queryKey: queryKeys.localBranches(localTabRepoTrim),
    queryFn: () => api.listLocalBranches(localTabRepoTrim),
    enabled: tab === 'local' && localTabRepoTrim.length > 0,
    retry: false,
  })
  // Reset the user-touched flag when the repo path changes — the branch
  // list belongs to a different repo now, so re-prefill is appropriate.
  useEffect(() => {
    setLocalTabHeadTouched(false)
  }, [localTabRepoTrim])
  // Prefill HEAD with the repo's current branch once the API resolves.
  useEffect(() => {
    if (localTabHeadTouched) return
    const next = localBranches?.head
    if (next && localTabHead !== next) setLocalTabHead(next)
  }, [localBranches, localTabHeadTouched, localTabHead])
  const prCanSubmit = trimmed.length > 0 && !create.isPending

  const vbranchTabRepoTrim = vbranchTabRepo.trim()
  const { data: vbranchInspect, isFetching: vbranchInspectFetching } = useQuery({
    queryKey: queryKeys.localSourceInspect(vbranchTabRepoTrim),
    queryFn: () => api.inspectLocalSource(vbranchTabRepoTrim),
    enabled: tab === 'vbranch' && vbranchTabRepoTrim.length > 0,
    retry: false,
  })
  // Reset the selected vbranch when the repo changes — what was valid
  // for the previous repo is almost never valid for the new one. We
  // key on the resolved repoPath so a transient inspect failure
  // doesn't lose the user's pick mid-typing.
  useEffect(() => {
    setVbranchSelected('')
  }, [vbranchTabRepoTrim])
  const vbranchCanSubmit =
    vbranchTabRepoTrim.length > 0 &&
    vbranchInspect?.kind === 'gitbutler' &&
    vbranchSelected.length > 0 &&
    !create.isPending

  function submitPrTab(): void {
    if (!prCanSubmit) return
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

  function submitLocalTab(): void {
    if (!localTabCanSubmit) return
    const payload: Parameters<typeof create.mutate>[0] = {
      // The server's parseSessionInput() resolves a path-shaped prInput to a
      // local-branch source. Pin localRepoPath to the same path so the
      // project-tier prompt resolver picks up `.better-review/review.md`
      // from this repo.
      prInput: localTabRepoTrim,
      localRepoPath: localTabRepoTrim,
      agent: effectiveAgent,
    }
    const head = localTabHead.trim()
    if (head) payload.localBranchHead = head
    const base = localTabBase.trim()
    if (base) payload.localBranchBase = base
    const extra = extraPrompt.trim()
    if (extra) payload.extraPrompt = extra
    create.mutate(payload)
  }

  function submitVbranchTab(): void {
    if (!vbranchCanSubmit) return
    const payload: Parameters<typeof create.mutate>[0] = {
      prInput: vbranchTabRepoTrim,
      localRepoPath: vbranchTabRepoTrim,
      vbranchName: vbranchSelected,
      agent: effectiveAgent,
    }
    const extra = extraPrompt.trim()
    if (extra) payload.extraPrompt = extra
    create.mutate(payload)
  }

  const agentFieldset = (
    <fieldset
      className="flex flex-wrap items-center gap-1.5 text-meta text-ink-secondary"
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
                className={cn('ml-1.5 text-[10px]', selected ? 'text-canvas/70' : 'text-ink-muted')}
              >
                {t('home.agent.defaultSuffix')}
              </span>
            ) : null}
          </button>
        )
      })}
    </fieldset>
  )

  const extraPromptPanel = extraOpen ? (
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
  )

  return (
    <div className="px-8 py-12 mx-auto" style={{ width: 'clamp(680px, 80vw, 880px)' }}>
      <header className="space-y-7">
        <div>
          <div className="text-caps tracking-caps text-ink-muted uppercase mb-3">
            {t('home.eyebrow')}
          </div>
          <h1 className="text-display text-ink-primary">{t('home.title')}</h1>
          <p className="mt-3 text-h2 text-ink-secondary font-normal">
            {tab === 'local'
              ? t('home.subtitleLocal')
              : tab === 'vbranch'
                ? t('home.subtitleVbranch')
                : t('home.subtitle')}
          </p>
        </div>

        <div
          role="tablist"
          aria-label={t('home.tabs.ariaLabel')}
          className="flex items-stretch gap-1 border-b border-rule"
        >
          <TopTabButton
            active={tab === 'pr'}
            onClick={() => setTab('pr')}
            label={t('home.tabs.pr')}
          />
          <TopTabButton
            active={tab === 'local'}
            onClick={() => setTab('local')}
            label={t('home.tabs.local')}
          />
          <TopTabButton
            active={tab === 'vbranch'}
            onClick={() => setTab('vbranch')}
            label={t('home.tabs.vbranch')}
          />
        </div>

        {tab === 'pr' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submitPrTab()
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
              <Button type="submit" variant="primary" size="md" disabled={!prCanSubmit}>
                {create.isPending ? t('home.starting') : t('home.startReview')}
              </Button>
            </div>

            <div className="flex items-center gap-2.5 rounded-lg bg-raised border border-rule pl-3.5 pr-3 py-1 transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus-within:border-brand focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)]">
              <Combobox
                value={localRepo}
                onChange={(next) => {
                  setLocalRepo(next)
                  setLocalRepoTouched(true)
                }}
                options={recentRepos?.items ?? []}
                getValue={(r) => r.path}
                getKey={(r) => r.path}
                ariaLabel={t('home.localRepoAriaLabel')}
                menuAriaLabel={t('home.recentReposMenuAriaLabel')}
                placeholder={t('home.localRepoPlaceholder')}
                leftIcon={<FolderGit2 size={16} aria-hidden="true" />}
                emptyHint={t('home.recentReposEmptyHint')}
                renderOption={(r) => (
                  <>
                    <span className="font-mono truncate">{r.path}</span>
                    {r.matchedCurrentRepo ? (
                      <span className="text-caps tracking-caps text-accent-ready uppercase shrink-0 rounded px-1.5 py-0.5 bg-[color-mix(in_oklch,var(--accent-ready)_18%,transparent)]">
                        {t('home.recentRepoCurrentBadge')}
                      </span>
                    ) : null}
                    <span className="ml-auto font-mono text-meta text-ink-muted shrink-0">
                      {t('home.recentRepoMeta', {
                        when: relativeTime(r.lastUsedAt),
                        count: r.useCount,
                      })}
                    </span>
                  </>
                )}
                rightSlot={
                  <>
                    {folderPickerSupported ? (
                      <button
                        type="button"
                        onClick={() => void browseLocalRepo('pr')}
                        disabled={pickerBusy !== null}
                        className="flex items-center gap-1 px-2 py-1 rounded text-meta text-ink-secondary hover:text-ink-primary hover:bg-canvas transition-colors duration-180 ease-out-quart disabled:opacity-50 disabled:cursor-progress"
                        aria-label={t('home.browseAriaLabel')}
                        title={t('home.browseTitle')}
                      >
                        <FolderOpen size={14} aria-hidden="true" />
                        {pickerBusy === 'pr' ? t('home.opening') : t('home.browse')}
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
                  </>
                }
              />
            </div>
            {pickerError ? (
              <div className="text-meta text-severity-must -mt-1 pl-1">{pickerError}</div>
            ) : null}
            {showAutoFillHint ? (
              <div className="text-meta text-ink-muted -mt-1 pl-1">
                {t('home.autoFillHint', { owner: target!.owner, repo: target!.repo })}
              </div>
            ) : null}

            {extraPromptPanel}
            {agentFieldset}
          </form>
        ) : tab === 'local' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submitLocalTab()
            }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2.5 rounded-lg bg-raised border border-rule pl-3.5 pr-1.5 py-1.5 transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus-within:border-brand focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)]">
              <FolderGit2 size={18} className="text-ink-muted shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={localTabRepo}
                onChange={(e) => setLocalTabRepo(e.target.value)}
                placeholder={t('home.local.repoPlaceholder')}
                className="flex-1 py-2 bg-transparent text-h2 text-ink-primary placeholder:text-ink-muted focus:outline-none font-mono"
                aria-label={t('home.local.repoAriaLabel')}
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
              {folderPickerSupported ? (
                <button
                  type="button"
                  onClick={() => void browseLocalRepo('local')}
                  disabled={pickerBusy !== null}
                  className="flex items-center gap-1 px-2 py-1 rounded text-meta text-ink-secondary hover:text-ink-primary hover:bg-canvas transition-colors duration-180 ease-out-quart disabled:opacity-50 disabled:cursor-progress"
                  aria-label={t('home.browseAriaLabel')}
                  title={t('home.browseTitle')}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  {pickerBusy === 'local' ? t('home.opening') : t('home.browse')}
                </button>
              ) : null}
              <Button type="submit" variant="primary" size="md" disabled={!localTabCanSubmit}>
                {create.isPending ? t('home.starting') : t('home.startReview')}
              </Button>
            </div>
            {pickerError ? (
              <div className="text-meta text-severity-must -mt-1 pl-1">{pickerError}</div>
            ) : null}

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5 rounded-lg bg-raised border border-rule pl-3.5 pr-3 py-1 transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus-within:border-brand focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)]">
                <span className="text-caps tracking-caps text-ink-muted uppercase shrink-0">
                  {t('home.local.headLabel')}
                </span>
                <Combobox
                  value={localTabHead}
                  onChange={(next) => {
                    setLocalTabHead(next)
                    setLocalTabHeadTouched(true)
                  }}
                  options={localBranches?.branches ?? []}
                  getValue={(b) => b.name}
                  getKey={(b) => b.name}
                  ariaLabel={t('home.local.headAriaLabel')}
                  menuAriaLabel={t('home.local.headMenuAriaLabel')}
                  placeholder={t('home.local.headPlaceholder')}
                  leftIcon={<GitBranch size={14} aria-hidden="true" />}
                  emptyHint={t('home.local.branchesEmptyHint')}
                  renderOption={(b) => (
                    <>
                      <span className="font-mono truncate">{b.name}</span>
                      {localBranches?.head === b.name ? (
                        <span className="text-caps tracking-caps text-accent-ready uppercase shrink-0 rounded px-1.5 py-0.5 bg-[color-mix(in_oklch,var(--accent-ready)_18%,transparent)]">
                          {t('home.local.branchHeadBadge')}
                        </span>
                      ) : null}
                      <span className="ml-auto font-mono text-meta text-ink-muted shrink-0">
                        {b.sha} · {relativeTime(b.committedAt * 1000)}
                      </span>
                    </>
                  )}
                />
              </div>
              <div className="flex items-center gap-2.5 rounded-lg bg-raised border border-rule pl-3.5 pr-3 py-1 transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus-within:border-brand focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)]">
                <span className="text-caps tracking-caps text-ink-muted uppercase shrink-0">
                  {t('home.local.baseLabel')}
                </span>
                <Combobox
                  value={localTabBase}
                  onChange={setLocalTabBase}
                  options={localBranches?.branches ?? []}
                  getValue={(b) => b.name}
                  getKey={(b) => b.name}
                  ariaLabel={t('home.local.baseAriaLabel')}
                  menuAriaLabel={t('home.local.baseMenuAriaLabel')}
                  placeholder={t('home.local.basePlaceholder')}
                  leftIcon={<GitBranch size={14} aria-hidden="true" />}
                  emptyHint={t('home.local.branchesEmptyHint')}
                  renderOption={(b) => (
                    <>
                      <span className="font-mono truncate">{b.name}</span>
                      <span className="ml-auto font-mono text-meta text-ink-muted shrink-0">
                        {b.sha} · {relativeTime(b.committedAt * 1000)}
                      </span>
                    </>
                  )}
                />
              </div>
            </div>
            <div className="text-meta text-ink-muted -mt-1 pl-1">
              {t('home.local.readOnlyHint')}
            </div>

            {extraPromptPanel}
            {agentFieldset}
          </form>
        ) : tab === 'vbranch' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submitVbranchTab()
            }}
            className="space-y-3"
          >
            <div className="flex items-center gap-2.5 rounded-lg bg-raised border border-rule pl-3.5 pr-1.5 py-1.5 transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus-within:border-brand focus-within:bg-canvas focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--brand)_16%,transparent)]">
              <FolderGit2 size={18} className="text-ink-muted shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={vbranchTabRepo}
                onChange={(e) => setVbranchTabRepo(e.target.value)}
                placeholder={t('home.vbranch.repoPlaceholder')}
                className="flex-1 py-2 bg-transparent text-h2 text-ink-primary placeholder:text-ink-muted focus:outline-none font-mono"
                aria-label={t('home.vbranch.repoAriaLabel')}
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
              {folderPickerSupported ? (
                <button
                  type="button"
                  onClick={() => void browseLocalRepo('vbranch')}
                  disabled={pickerBusy !== null}
                  className="flex items-center gap-1 px-2 py-1 rounded text-meta text-ink-secondary hover:text-ink-primary hover:bg-canvas transition-colors duration-180 ease-out-quart disabled:opacity-50 disabled:cursor-progress"
                  aria-label={t('home.browseAriaLabel')}
                  title={t('home.browseTitle')}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  {pickerBusy === 'vbranch' ? t('home.opening') : t('home.browse')}
                </button>
              ) : null}
              <Button type="submit" variant="primary" size="md" disabled={!vbranchCanSubmit}>
                {create.isPending ? t('home.starting') : t('home.startReview')}
              </Button>
            </div>
            {pickerError ? (
              <div className="text-meta text-severity-must -mt-1 pl-1">{pickerError}</div>
            ) : null}

            {vbranchTabRepoTrim.length === 0 ? (
              <div className="text-meta text-ink-muted pl-1">{t('home.vbranch.pickFirst')}</div>
            ) : vbranchInspectFetching && !vbranchInspect ? (
              <div className="text-meta text-ink-muted pl-1">{t('home.vbranch.inspecting')}</div>
            ) : vbranchInspect?.kind === 'none' ? (
              <div className="text-meta text-severity-must pl-1">{t('home.vbranch.notARepo')}</div>
            ) : vbranchInspect?.kind === 'git' ? (
              <div className="text-meta text-ink-muted pl-1">
                {t('home.vbranch.notGitButler')}
                {vbranchInspect.warning ? ` — ${vbranchInspect.warning}` : null}
              </div>
            ) : vbranchInspect?.kind === 'gitbutler' &&
              (!vbranchInspect.vbranches || vbranchInspect.vbranches.length === 0) ? (
              <div className="text-meta text-ink-muted pl-1">{t('home.vbranch.empty')}</div>
            ) : vbranchInspect?.kind === 'gitbutler' ? (
              (() => {
                const vbranches = vbranchInspect.vbranches!
                const selected = vbranches.find((v) => v.name === vbranchSelected) ?? null
                return (
                  <div className="flex items-center gap-2.5 pl-1">
                    <span className="text-caps tracking-caps text-ink-muted uppercase shrink-0">
                      {t('home.vbranch.label')}
                    </span>
                    <div className="flex-1">
                      <SelectMenu
                        value={selected}
                        options={vbranches}
                        onChange={(v) => setVbranchSelected(v.name)}
                        getKey={(v) => v.name}
                        ariaLabel={t('home.vbranch.ariaLabel')}
                        menuAriaLabel={t('home.vbranch.menuAriaLabel')}
                        renderEmpty={() => (
                          <span className="flex-1 text-ink-muted">{t('home.vbranch.pickOne')}</span>
                        )}
                        renderTrigger={(v) => (
                          <>
                            <GitBranch
                              size={14}
                              className="text-ink-muted shrink-0"
                              aria-hidden="true"
                            />
                            <span className="font-mono truncate">{v.name}</span>
                            <span className="text-meta text-ink-muted shrink-0">
                              · {v.commitCount} commit{v.commitCount === 1 ? '' : 's'}
                              {v.stackSize > 1
                                ? ` · stack ${v.stackPosition + 1}/${v.stackSize}`
                                : ''}
                            </span>
                          </>
                        )}
                        renderOption={(v, isSel) => (
                          <>
                            <GitBranch
                              size={14}
                              className="text-ink-muted shrink-0"
                              aria-hidden="true"
                            />
                            <span className="font-mono truncate">{v.name}</span>
                            <span className="ml-auto text-meta text-ink-muted shrink-0">
                              {v.commitCount} commit{v.commitCount === 1 ? '' : 's'}
                              {v.stackSize > 1
                                ? ` · stack ${v.stackPosition + 1}/${v.stackSize}`
                                : ''}
                            </span>
                            <SelectMenuCheck selected={isSel} />
                          </>
                        )}
                      />
                    </div>
                  </div>
                )
              })()
            ) : null}

            <div className="text-meta text-ink-muted -mt-1 pl-1">
              {t('home.vbranch.readOnlyHint')}
            </div>

            {extraPromptPanel}
            {agentFieldset}
          </form>
        ) : null}

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
