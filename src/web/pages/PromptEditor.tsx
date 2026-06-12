import type { PRSession, RulesSource } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderGit2, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Button, ConfirmAction, KbdTooltip, Tag } from '@/components/ui'
import { api, queryKeys, ApiError, type WritablePromptScope } from '@/lib/api'
import { useRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type Tab = 'effective' | 'framework' | WritablePromptScope

const TABS: Tab[] = ['effective', 'framework', 'project', 'global']

const ELIGIBLE_RERUN_STATUSES = new Set(['running', 'ready', 'failed', 'cancelled'])

export function PromptEditor() {
  const { t } = useTranslation()
  const relativeTime = useRelativeTime()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // The repo whose `.better-review/review.md` backs the Project scope. Empty
  // means no repo is pinned — the Project tab then has nothing to resolve
  // against and the effective chain collapses to global → builtin. Seeded from
  // the `?repo=` query param so a "Prompt rules" jump from a session detail
  // lands on the rules that review uses (and survives a refresh).
  const [repo, setRepo] = useState(() => searchParams.get('repo') ?? '')
  const repoTrimmed = repo.trim()
  const repoArg = repoTrimmed.length > 0 ? repoTrimmed : null

  const promptsQ = useQuery({
    queryKey: queryKeys.prompts(repoArg),
    queryFn: () => api.getPrompts(repoArg),
  })
  const sessionsQ = useQuery({ queryKey: queryKeys.sessions, queryFn: api.listSessions })
  const { data: health } = useQuery({ queryKey: queryKeys.health, queryFn: api.health })
  const { data: recentRepos } = useQuery({
    queryKey: queryKeys.recentRepos('', ''),
    queryFn: () => api.recentRepos({ limit: 10 }),
  })

  const [tab, setTab] = useState<Tab>('effective')
  const [draft, setDraft] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [pickerBusy, setPickerBusy] = useState(false)

  const data = promptsQ.data
  const isWritable = tab === 'project' || tab === 'global'
  const needsRepo = tab === 'project' && repoArg === null

  useEffect(() => {
    setDraft(null)
  }, [tab])

  // A repo switch re-resolves Project + Guidelines tabs; drop any in-progress
  // edit so the textarea reflects the newly fetched content.
  useEffect(() => {
    setDraft(null)
  }, [repoArg])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's'
      if (!isSave) return
      if (!isWritable || draft === null) return
      e.preventDefault()
      saveMut.mutate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const folderPickerSupported = health?.fs?.folderPicker?.supported ?? false

  async function browseRepo(): Promise<void> {
    setPickerError(null)
    setPickerBusy(true)
    try {
      const r = await api.pickDirectory('Select repository for project rules')
      if (r.path) setRepo(r.path)
    } catch (e) {
      setPickerError(e instanceof ApiError ? e.message : t('prompt.repo.pickerError'))
    } finally {
      setPickerBusy(false)
    }
  }

  const saveMut = useMutation({
    mutationFn: () => {
      if (!isWritable || draft === null) return Promise.reject(new Error('nothing to save'))
      const scope = tab as WritablePromptScope
      return api.putPrompt(scope, draft, scope === 'project' ? repoArg : null)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.promptsBase })
      setDraft(null)
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 2000)
    },
  })

  const resetMut = useMutation({
    mutationFn: () => {
      if (!isWritable) return Promise.reject(new Error('not writable'))
      const scope = tab as WritablePromptScope
      return api.deletePrompt(scope, scope === 'project' ? repoArg : null)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.promptsBase })
      setDraft(null)
    },
  })

  // Sessions a prompt edit can be re-applied to. A Project-scope edit only
  // affects sessions pinned to that same repo; Global affects all.
  const eligibleSessions = useMemo<PRSession[]>(() => {
    const all = (sessionsQ.data ?? []).filter((s) => ELIGIBLE_RERUN_STATUSES.has(s.status))
    if (tab === 'project') {
      const resolved = data?.repo ?? null
      if (resolved === null) return []
      return all.filter((s) => s.localRepoPath === resolved)
    }
    return all
  }, [sessionsQ.data, tab, data?.repo])

  const scopeState = data && isWritable ? data.rules.scopes[tab as WritablePromptScope] : null
  const writableValue = isWritable && draft !== null ? draft : (scopeState?.content ?? '')

  const sourceLabel = (source: RulesSource): string => t(`prompt.sourceLabel.${source}`)
  const tabTitle =
    tab === 'effective'
      ? t('prompt.tabTitleEffective')
      : t(`prompt.tabs.${tab}`, t('prompt.tabTitleFallback'))

  return (
    <div className="flex h-full min-h-0">
      <aside
        className="w-[140px] shrink-0 border-r border-rule bg-raised/40 py-6"
        role="tablist"
        aria-orientation="vertical"
      >
        {TABS.map((id) => {
          const isReadOnly = id === 'effective' || id === 'framework'
          const exists =
            (id === 'project' || id === 'global') && data ? data.rules.scopes[id].exists : true
          return (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'relative w-full px-5 py-3 text-left text-h2 transition-colors duration-180 ease-out-quart',
                tab === id ? 'text-ink-primary' : 'text-ink-muted hover:text-ink-primary',
              )}
            >
              {tab === id ? (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-2 bottom-2 w-[2px] bg-brand"
                />
              ) : null}
              <span className="block">{t(`prompt.tabs.${id}`)}</span>
              {isReadOnly ? (
                <span className="block mt-0.5 text-caps tracking-caps uppercase text-ink-muted">
                  {t('prompt.tabState.readOnly')}
                </span>
              ) : !exists ? (
                <span className="block mt-0.5 text-caps tracking-caps uppercase text-ink-muted">
                  {t('prompt.tabState.empty')}
                </span>
              ) : null}
            </button>
          )
        })}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="px-8 pt-7 pb-4 border-b border-rule flex items-baseline gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-caps tracking-caps text-ink-muted uppercase">
              {t('app.nav.prompt')}
            </div>
            <h1 className="text-h1 text-ink-primary mt-1">{tabTitle}</h1>
          </div>
          <div className="text-meta text-ink-secondary">
            {t('prompt.source')}{' '}
            <strong data-testid="prompt-source" className="text-ink-primary font-semibold">
              {data ? sourceLabel(data.rules.effective.source) : '—'}
            </strong>
          </div>
          {isWritable && eligibleSessions.length > 0 && draft === null ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowApplyModal(true)}>
              {t('prompt.applyToCurrent')}
            </Button>
          ) : null}
        </header>

        {tab === 'effective' || tab === 'project' ? (
          <div className="px-8 pt-4">
            <div className="flex items-center gap-2.5 rounded-lg bg-raised border border-rule pl-3 pr-3 py-1 transition-[border-color,box-shadow,background-color] duration-180 ease-out-quart focus-within:border-brand focus-within:bg-canvas">
              <FolderGit2 size={15} className="text-ink-muted shrink-0" aria-hidden="true" />
              <span className="text-caps tracking-caps text-ink-muted uppercase shrink-0">
                {t('prompt.repo.label')}
              </span>
              <input
                type="text"
                list="prompt-recent-repos"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder={t('prompt.repo.placeholder')}
                className="flex-1 py-1.5 bg-transparent text-meta text-ink-primary placeholder:text-ink-muted focus:outline-none font-mono"
                aria-label={t('prompt.repo.ariaLabel')}
                spellCheck={false}
                autoComplete="off"
              />
              {folderPickerSupported ? (
                <button
                  type="button"
                  onClick={browseRepo}
                  disabled={pickerBusy}
                  className="flex items-center gap-1 px-2 py-1 rounded text-meta text-ink-secondary hover:text-ink-primary hover:bg-canvas transition-colors duration-180 ease-out-quart disabled:opacity-50 disabled:cursor-progress"
                  aria-label={t('prompt.repo.browseAriaLabel')}
                >
                  <FolderOpen size={14} aria-hidden="true" />
                  {pickerBusy ? t('prompt.repo.opening') : t('prompt.repo.browse')}
                </button>
              ) : null}
              {repo ? (
                <button
                  type="button"
                  onClick={() => setRepo('')}
                  className="text-meta text-ink-muted hover:text-ink-secondary transition-colors duration-180 ease-out-quart"
                  aria-label={t('prompt.repo.clearAriaLabel')}
                >
                  {t('prompt.repo.clear')}
                </button>
              ) : null}
            </div>
            <datalist id="prompt-recent-repos">
              {recentRepos?.items.map((r) => (
                <option key={r.path} value={r.path}>
                  {t('prompt.repo.recentMeta', {
                    when: relativeTime(r.lastUsedAt),
                    count: r.useCount,
                  })}
                </option>
              ))}
            </datalist>
            {pickerError ? (
              <div className="text-meta text-severity-must mt-1 pl-1">{pickerError}</div>
            ) : (
              <p className="text-meta text-ink-muted mt-1 pl-1">{t('prompt.repo.hint')}</p>
            )}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-auto px-8 py-6 space-y-4">
          {!data ? (
            <div className="text-meta text-ink-muted">{t('prompt.loading')}</div>
          ) : tab === 'effective' ? (
            <section className="space-y-2">
              <textarea
                aria-label={t('prompt.guidelinesAria')}
                readOnly
                value={data.rules.effective.content}
                className="w-full h-[60vh] p-4 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary resize-y"
              />
              <p className="text-meta text-ink-muted">
                {t('prompt.readOnlyCurrent', { source: sourceLabel(data.rules.effective.source) })}
                {data.rules.effective.path ? (
                  <span className="ml-2 font-mono">{data.rules.effective.path}</span>
                ) : null}
              </p>
            </section>
          ) : tab === 'framework' ? (
            <section className="space-y-2">
              <textarea
                aria-label={t('prompt.frameworkAria')}
                readOnly
                value={data.framework.content}
                className="w-full h-[60vh] p-4 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary resize-y"
              />
              <p className="text-meta text-ink-muted">
                <Trans
                  i18nKey="prompt.readOnlyFramework"
                  values={{ placeholder: '{{RULES}}' }}
                  components={[<code key="ph" className="font-mono" />]}
                />
              </p>
            </section>
          ) : needsRepo ? (
            <section className="space-y-3 border border-rule rounded-md py-8 px-6 text-center">
              <p className="text-body text-ink-secondary">{t('prompt.repo.pickFirst')}</p>
            </section>
          ) : !scopeState!.exists && draft === null ? (
            <section className="space-y-3 border border-rule rounded-md py-8 px-6 text-center">
              <p className="text-body text-ink-secondary">
                {t('prompt.noOverride', {
                  scope: tab,
                  source: sourceLabel(data.rules.effective.source),
                })}
              </p>
              <p className="font-mono text-meta text-ink-muted">{scopeState!.path}</p>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setDraft(data.rules.effective.content)}
              >
                {t('prompt.overrideAtScope')}
              </Button>
            </section>
          ) : (
            <section className="space-y-3">
              <textarea
                aria-label={t('prompt.writableAria', { scope: tab })}
                value={writableValue}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full h-[60vh] p-4 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart resize-y"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <KbdTooltip keys={['⌘', 'S']} label={t('common.save')}>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => saveMut.mutate()}
                    disabled={draft === null || saveMut.isPending}
                  >
                    {saveMut.isPending ? t('prompt.saving') : t('prompt.save', { scope: tab })}
                  </Button>
                </KbdTooltip>
                {scopeState!.exists ? (
                  <ConfirmAction
                    title={t('prompt.resetTitle')}
                    description={t('prompt.resetDesc', { path: scopeState!.path })}
                    confirmLabel={t('prompt.resetConfirm')}
                    onConfirm={() => resetMut.mutate()}
                    disabled={resetMut.isPending}
                  >
                    {(requestConfirm) => (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={requestConfirm}
                        disabled={resetMut.isPending}
                      >
                        {t('prompt.resetButton')}
                      </Button>
                    )}
                  </ConfirmAction>
                ) : null}
                {savedFlash ? <Tag tone="success">{t('common.saved')}</Tag> : null}
                <span className="ml-auto font-mono text-meta text-ink-muted">
                  {scopeState!.path}
                </span>
              </div>
              {saveMut.isError ? (
                <div className="text-meta text-severity-must">
                  {saveMut.error instanceof ApiError
                    ? saveMut.error.message
                    : t('prompt.saveFailed')}
                </div>
              ) : null}
              {resetMut.isError ? (
                <div className="text-meta text-severity-must">
                  {resetMut.error instanceof ApiError
                    ? resetMut.error.message
                    : t('prompt.resetFailed')}
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>

      {showApplyModal ? (
        <ApplyToSessionsModal
          sessions={eligibleSessions}
          onClose={() => setShowApplyModal(false)}
          onApplied={(firstId) => {
            setShowApplyModal(false)
            void qc.invalidateQueries({ queryKey: queryKeys.sessions })
            navigate(`/session/${firstId}`)
          }}
        />
      ) : null}
    </div>
  )
}

function ApplyToSessionsModal({
  sessions,
  onClose,
  onApplied,
}: {
  sessions: PRSession[]
  onClose: () => void
  onApplied: (firstId: string) => void
}) {
  const { t } = useTranslation()
  const sorted = useMemo(() => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt), [sessions])
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    if (sorted[0]) init[sorted[0].id] = true
    return init
  })
  const apply = useMutation({
    mutationFn: async () => {
      const ids = Object.entries(checked)
        .filter(([, v]) => v)
        .map(([id]) => id)
      const freshIds: string[] = []
      for (const id of ids) {
        const { id: freshId } = await api.rerunSession(id)
        freshIds.push(freshId)
      }
      return freshIds
    },
    onSuccess: (freshIds) => {
      if (freshIds.length > 0) onApplied(freshIds[0]!)
      else onClose()
    },
  })
  const checkedCount = Object.values(checked).filter(Boolean).length
  return (
    <div
      className="fixed inset-0 bg-ink-primary/30 z-40 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('prompt.applyModal.ariaLabel')}
      onClick={onClose}
    >
      <div
        className="bg-canvas border border-rule p-6 w-full max-w-md space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-h1 text-ink-primary">{t('prompt.applyModal.title')}</h2>
        <p className="text-meta text-ink-secondary">{t('prompt.applyModal.subtitle')}</p>
        <ul className="space-y-1 max-h-64 overflow-auto divide-y divide-rule">
          {sorted.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-2 py-2 text-body cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!checked[s.id]}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [s.id]: e.target.checked }))}
                  className="accent-brand"
                />
                <span className="font-mono text-meta text-ink-secondary">
                  {s.owner}/{s.repo}#{s.number}
                </span>
                <span className="text-meta text-ink-primary truncate">{s.title ?? ''}</span>
                <span className="ml-auto text-caps tracking-caps text-ink-muted uppercase">
                  {t(`sidebar.status.${s.status}`)}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {apply.isError ? (
          <div className="text-meta text-severity-must">
            {apply.error instanceof ApiError
              ? apply.error.message
              : t('prompt.applyModal.rerunFailed')}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-rule">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => apply.mutate()}
            disabled={checkedCount === 0 || apply.isPending}
          >
            {apply.isPending
              ? t('prompt.applyModal.applying')
              : t('prompt.applyModal.apply', { count: checkedCount })}
          </Button>
        </div>
      </div>
    </div>
  )
}
