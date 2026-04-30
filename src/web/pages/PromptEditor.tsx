import type { PRSession, RulesSource } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button, ConfirmAction, KbdTooltip, Tag } from '@/components/ui'
import { api, queryKeys, ApiError, type WritablePromptScope } from '@/lib/api'
import { cn } from '@/lib/utils'

type Tab = 'effective' | 'framework' | WritablePromptScope

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'effective', label: 'Effective' },
  { id: 'framework', label: 'Framework' },
  { id: 'project', label: 'Project' },
  { id: 'global', label: 'Global' },
]

const ELIGIBLE_RERUN_STATUSES = new Set(['running', 'ready', 'failed', 'cancelled'])

function sourceLabel(source: RulesSource): string {
  switch (source) {
    case 'project':
      return 'project override'
    case 'global':
      return 'global override'
    case 'builtin':
      return 'builtin rules (no overrides)'
  }
}

export function PromptEditor() {
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
    return <div className="p-8 text-meta text-ink-muted">Loading prompt…</div>
  }

  const scopeState = isWritable ? data.rules.scopes[tab as WritablePromptScope] : null
  const writableValue = isWritable && draft !== null ? draft : (scopeState?.content ?? '')

  return (
    <div className="flex h-full min-h-0">
      <aside
        className="w-[140px] shrink-0 border-r border-rule bg-raised/40 py-6"
        role="tablist"
        aria-orientation="vertical"
      >
        {TABS.map((t) => {
          const isReadOnly = t.id === 'effective' || t.id === 'framework'
          const exists =
            t.id === 'project' || t.id === 'global' ? data.rules.scopes[t.id].exists : true
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'relative w-full px-5 py-3 text-left text-caps tracking-caps uppercase transition-colors duration-180 ease-out-quart',
                tab === t.id ? 'text-ink-primary' : 'text-ink-muted hover:text-ink-primary',
              )}
            >
              {tab === t.id ? (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-2 bottom-2 w-[2px] bg-brand"
                />
              ) : null}
              <span className="block">{t.label}</span>
              {isReadOnly ? (
                <span className="block mt-1 text-[9px] tracking-caps text-ink-muted">
                  read only
                </span>
              ) : !exists ? (
                <span className="block mt-1 text-[9px] tracking-caps text-ink-muted">empty</span>
              ) : null}
            </button>
          )
        })}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="px-8 pt-7 pb-4 border-b border-rule flex items-baseline gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-caps tracking-caps text-ink-muted uppercase">Prompt</div>
            <h1 className="text-h1 text-ink-primary mt-1">
              {TABS.find((t) => t.id === tab)?.label ?? 'Prompt'}
            </h1>
          </div>
          <div className="text-meta text-ink-secondary">
            Source:{' '}
            <strong data-testid="prompt-source" className="text-ink-primary font-semibold">
              {sourceLabel(data.rules.effective.source)}
            </strong>
          </div>
          {isWritable && eligibleSessions.length > 0 && draft === null ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowApplyModal(true)}>
              Apply to current session
            </Button>
          ) : null}
        </header>

        <div className="flex-1 min-h-0 overflow-auto px-8 py-6 space-y-4">
          {tab === 'effective' ? (
            <section className="space-y-2">
              <textarea
                aria-label="Effective rules"
                readOnly
                value={data.rules.effective.content}
                className="w-full h-[60vh] p-4 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary resize-y"
              />
              <p className="text-meta text-ink-muted">
                Read-only. Effective source: {sourceLabel(data.rules.effective.source)}.
                {data.rules.effective.path ? (
                  <span className="ml-2 font-mono">{data.rules.effective.path}</span>
                ) : null}
              </p>
            </section>
          ) : tab === 'framework' ? (
            <section className="space-y-2">
              <textarea
                aria-label="Framework"
                readOnly
                value={data.framework.content}
                className="w-full h-[60vh] p-4 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary resize-y"
              />
              <p className="text-meta text-ink-muted">
                Read-only. The framework is built into better-review and cannot be overridden. Your
                rules (Project / Global) are injected at the{' '}
                <code className="font-mono">{'{{RULES}}'}</code> placeholder.
              </p>
            </section>
          ) : !scopeState!.exists && draft === null ? (
            <section className="space-y-3 border border-rule rounded-md py-8 px-6 text-center">
              <p className="text-body text-ink-secondary">
                No {tab} override exists. The {sourceLabel(data.rules.effective.source)} applies.
              </p>
              <p className="font-mono text-meta text-ink-muted">{scopeState!.path}</p>
              <Button
                type="button"
                variant="ink"
                size="sm"
                onClick={() => setDraft(data.rules.effective.content)}
              >
                Override at this scope
              </Button>
            </section>
          ) : (
            <section className="space-y-3">
              <textarea
                aria-label={`${tab} rules`}
                value={writableValue}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full h-[60vh] p-4 font-mono text-code rounded-md bg-sunken border border-rule text-ink-primary focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart resize-y"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <KbdTooltip keys={['⌘', 'S']} label="save">
                  <Button
                    type="button"
                    variant="ink"
                    size="sm"
                    onClick={() => saveMut.mutate()}
                    disabled={draft === null || saveMut.isPending}
                  >
                    {saveMut.isPending ? 'Saving…' : `Save to ${tab}`}
                  </Button>
                </KbdTooltip>
                {scopeState!.exists ? (
                  <ConfirmAction
                    title="Reset prompt override?"
                    description={`${scopeState!.path} will be deleted. The next-level fallback will apply.`}
                    confirmLabel="Reset"
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
                        Reset to fallback
                      </Button>
                    )}
                  </ConfirmAction>
                ) : null}
                {savedFlash ? <Tag tone="success">saved</Tag> : null}
                <span className="ml-auto font-mono text-meta text-ink-muted">
                  {scopeState!.path}
                </span>
              </div>
              {saveMut.isError ? (
                <div className="text-meta text-severity-must">
                  {saveMut.error instanceof ApiError ? saveMut.error.message : 'Save failed'}
                </div>
              ) : null}
              {resetMut.isError ? (
                <div className="text-meta text-severity-must">
                  {resetMut.error instanceof ApiError ? resetMut.error.message : 'Reset failed'}
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
      aria-label="Apply prompt to sessions"
      onClick={onClose}
    >
      <div
        className="bg-canvas border border-rule p-6 w-full max-w-md space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-h1 text-ink-primary">Apply prompt to sessions</h2>
        <p className="text-meta text-ink-secondary">
          Selected sessions will be rerun with the saved prompt.
        </p>
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
                  {s.status}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {apply.isError ? (
          <div className="text-meta text-severity-must">
            {apply.error instanceof ApiError ? apply.error.message : 'Rerun failed'}
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-rule">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ink"
            size="sm"
            onClick={() => apply.mutate()}
            disabled={checkedCount === 0 || apply.isPending}
          >
            {apply.isPending ? 'Applying…' : `Apply (${checkedCount})`}
          </Button>
        </div>
      </div>
    </div>
  )
}
