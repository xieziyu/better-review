import type { PRSession, RulesSource } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

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

  // Reset draft when switching tabs.
  useEffect(() => {
    setDraft(null)
  }, [tab])

  // ⌘S / Ctrl+S to save when on a writable scope and dirty.
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
    return <div className="p-6 text-sm text-gray-500">Loading prompt…</div>
  }

  const scopeState = isWritable ? data.rules.scopes[tab as WritablePromptScope] : null
  const writableValue = isWritable && draft !== null ? draft : (scopeState?.content ?? '')

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Prompt</h1>
        <span className="text-sm text-gray-500">
          Source:{' '}
          <strong data-testid="prompt-source" className="text-gray-700 dark:text-gray-300">
            {sourceLabel(data.rules.effective.source)}
          </strong>
        </span>
      </header>

      <div
        role="tablist"
        className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800"
      >
        {TABS.map((t) => {
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
                'px-3 py-2 text-sm border-b-2 -mb-px',
                tab === t.id
                  ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100',
              )}
            >
              {t.label}
              {(t.id === 'project' || t.id === 'global') && !exists && (
                <span className="ml-1 text-xs text-gray-400">(empty)</span>
              )}
            </button>
          )
        })}
        {isWritable && eligibleSessions.length > 0 && draft === null && (
          <button
            type="button"
            onClick={() => setShowApplyModal(true)}
            className="ml-auto px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            Apply to current session
          </button>
        )}
      </div>

      {tab === 'effective' ? (
        <section className="space-y-2">
          <textarea
            aria-label="Effective rules"
            readOnly
            value={data.rules.effective.content}
            className="w-full h-[60vh] p-3 font-mono text-sm rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300"
          />
          <p className="text-xs text-gray-500">
            Read-only. Effective source: {sourceLabel(data.rules.effective.source)}.
            {data.rules.effective.path && (
              <span className="ml-2 font-mono">{data.rules.effective.path}</span>
            )}
          </p>
        </section>
      ) : tab === 'framework' ? (
        <section className="space-y-2">
          <textarea
            aria-label="Framework"
            readOnly
            value={data.framework.content}
            className="w-full h-[60vh] p-3 font-mono text-sm rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300"
          />
          <p className="text-xs text-gray-500">
            Read-only. The framework is built into better-review and cannot be overridden. Your
            rules (Project / Global) are injected at the <code>{'{{RULES}}'}</code> placeholder.
          </p>
        </section>
      ) : !scopeState!.exists && draft === null ? (
        <section className="space-y-3 rounded-md border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No {tab} override exists. The {sourceLabel(data.rules.effective.source)} applies.
          </p>
          <p className="text-xs text-gray-500 font-mono">{scopeState!.path}</p>
          <button
            type="button"
            onClick={() => setDraft(data.rules.effective.content)}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            Override at this scope
          </button>
        </section>
      ) : (
        <section className="space-y-3">
          <textarea
            aria-label={`${tab} rules`}
            value={writableValue}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full h-[60vh] p-3 font-mono text-sm rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => saveMut.mutate()}
              disabled={draft === null || saveMut.isPending}
              className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:dark:bg-gray-700"
            >
              {saveMut.isPending ? 'Saving…' : `Save to ${tab}`}
            </button>
            <span className="text-xs text-gray-500">
              <kbd className="px-1 py-0.5 rounded border border-gray-300 dark:border-gray-700 font-mono">
                ⌘S
              </kbd>
            </span>
            {scopeState!.exists && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${scopeState!.path}? The next-level fallback will apply.`,
                    )
                  ) {
                    resetMut.mutate()
                  }
                }}
                disabled={resetMut.isPending}
                className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                Reset to fallback
              </button>
            )}
            {savedFlash && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>
            )}
            <span className="ml-auto text-xs text-gray-500 font-mono">{scopeState!.path}</span>
          </div>
          {saveMut.isError && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {saveMut.error instanceof ApiError ? saveMut.error.message : 'Save failed'}
            </div>
          )}
          {resetMut.isError && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {resetMut.error instanceof ApiError ? resetMut.error.message : 'Reset failed'}
            </div>
          )}
        </section>
      )}

      {showApplyModal && (
        <ApplyToSessionsModal
          sessions={eligibleSessions}
          onClose={() => setShowApplyModal(false)}
          onApplied={(firstId) => {
            setShowApplyModal(false)
            void qc.invalidateQueries({ queryKey: queryKeys.sessions })
            navigate(`/pr/${firstId}`)
          }}
        />
      )}
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
      className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Apply prompt to sessions"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-950 rounded-md border border-gray-200 dark:border-gray-800 p-4 w-full max-w-md space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Apply prompt to sessions</h2>
        <p className="text-xs text-gray-500">
          Selected sessions will be rerun with the saved prompt.
        </p>
        <ul className="space-y-1 max-h-64 overflow-auto">
          {sorted.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-2 text-sm py-1">
                <input
                  type="checkbox"
                  checked={!!checked[s.id]}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [s.id]: e.target.checked }))}
                />
                <span className="font-mono text-xs">
                  {s.owner}/{s.repo}#{s.number}
                </span>
                <span className="text-gray-500">{s.title ?? ''}</span>
                <span className="ml-auto text-xs text-gray-500">{s.status}</span>
              </label>
            </li>
          ))}
        </ul>
        {apply.isError && (
          <div className="text-xs text-red-600 dark:text-red-400">
            {apply.error instanceof ApiError ? apply.error.message : 'Rerun failed'}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => apply.mutate()}
            disabled={checkedCount === 0 || apply.isPending}
            className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:dark:bg-gray-700"
          >
            {apply.isPending ? 'Applying…' : `Apply (${checkedCount})`}
          </button>
        </div>
      </div>
    </div>
  )
}
