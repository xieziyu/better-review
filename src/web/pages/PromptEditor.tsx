import type { PRSession, RulesSource } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button, ConfirmAction, KbdTooltip, Tag } from '@/components/ui'
import { api, queryKeys, ApiError, type WritablePromptScope } from '@/lib/api'
import { cn } from '@/lib/utils'

type Tab = 'effective' | 'framework' | WritablePromptScope

const TABS: Tab[] = ['effective', 'framework', 'project', 'global']

const ELIGIBLE_RERUN_STATUSES = new Set(['running', 'ready', 'failed', 'cancelled'])

export function PromptEditor() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const promptsQ = useQuery({ queryKey: queryKeys.prompts, queryFn: api.getPrompts })
  const sessionsQ = useQuery({ queryKey: queryKeys.sessions, queryFn: api.listSessions })

  const [tab, setTab] = useState<Tab>('effective')
  const [draft, setDraft] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [showApplyModal, setShowApplyModal] = useState(false)

  const data = promptsQ.data
  const isWritable = tab === 'project' || tab === 'global'

  useEffect(() => {
    setDraft(null)
  }, [tab])

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

  const saveMut = useMutation({
    mutationFn: () => {
      if (!isWritable || draft === null) return Promise.reject(new Error('nothing to save'))
      return api.putPrompt(tab as WritablePromptScope, draft)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.prompts })
      setDraft(null)
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 2000)
    },
  })

  const resetMut = useMutation({
    mutationFn: () => {
      if (!isWritable) return Promise.reject(new Error('not writable'))
      return api.deletePrompt(tab as WritablePromptScope)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.prompts })
      setDraft(null)
    },
  })

  const eligibleSessions = useMemo<PRSession[]>(
    () => (sessionsQ.data ?? []).filter((s) => ELIGIBLE_RERUN_STATUSES.has(s.status)),
    [sessionsQ.data],
  )

  if (!data) {
    return <div className="p-8 text-meta text-ink-muted">{t('prompt.loading')}</div>
  }

  const scopeState = isWritable ? data.rules.scopes[tab as WritablePromptScope] : null
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
          const exists = id === 'project' || id === 'global' ? data.rules.scopes[id].exists : true
          return (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'relative w-full px-5 py-3 text-left text-caps tracking-caps uppercase transition-colors duration-180 ease-out-quart',
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
                <span className="block mt-1 text-[9px] tracking-caps text-ink-muted">
                  {t('prompt.tabState.readOnly')}
                </span>
              ) : !exists ? (
                <span className="block mt-1 text-[9px] tracking-caps text-ink-muted">
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
              {sourceLabel(data.rules.effective.source)}
            </strong>
          </div>
          {isWritable && eligibleSessions.length > 0 && draft === null ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowApplyModal(true)}>
              {t('prompt.applyToCurrent')}
            </Button>
          ) : null}
        </header>

        <div className="flex-1 min-h-0 overflow-auto px-8 py-6 space-y-4">
          {tab === 'effective' ? (
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
                variant="ink"
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
                    variant="ink"
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
            navigate(`/pr/${firstId}`)
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
            variant="ink"
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
