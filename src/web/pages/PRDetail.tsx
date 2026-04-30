import type { AgentKind, HealthStatus, PRSession, SessionStatus } from '@shared/types'
import { AGENT_KINDS } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RotateCw,
  ExternalLink,
  Loader2,
  Check,
  AlertTriangle,
  CheckCheck,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { FindingList } from '@/components/FindingList'
import { SubmitDrawer } from '@/components/SubmitDrawer'
import { api, queryKeys, ApiError } from '@/lib/api'
import { useSSE } from '@/lib/sse'
import { cn } from '@/lib/utils'

const STATUS_BADGE: Record<SessionStatus, { label: string; cls: string }> = {
  running: {
    label: 'running',
    cls: 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40',
  },
  pending: {
    label: 'pending',
    cls: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40',
  },
  ready: {
    label: 'ready',
    cls: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
  },
  failed: {
    label: 'failed',
    cls: 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40',
  },
  submitted: {
    label: 'submitted',
    cls: 'text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950/40',
  },
  archived: {
    label: 'archived',
    cls: 'text-gray-500 bg-gray-100 dark:bg-gray-800',
  },
}

function StatusBadge({ status }: { status: SessionStatus }) {
  const { label, cls } = STATUS_BADGE[status]
  const Icon =
    status === 'running'
      ? Loader2
      : status === 'ready'
        ? Check
        : status === 'failed'
          ? AlertTriangle
          : status === 'submitted'
            ? CheckCheck
            : null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        cls,
      )}
    >
      {Icon && <Icon size={12} className={status === 'running' ? 'animate-spin' : undefined} />}
      {label}
    </span>
  )
}

function PRHeader({
  session,
  selectedCount,
  onRerun,
  onSubmit,
  onDelete,
  rerunPending,
  deletePending,
  rerunAgent,
  onRerunAgentChange,
  health,
}: {
  session: PRSession
  selectedCount: number
  onRerun: () => void
  onSubmit: () => void
  onDelete: () => void
  rerunPending: boolean
  deletePending: boolean
  rerunAgent: AgentKind
  onRerunAgentChange: (kind: AgentKind) => void
  health: HealthStatus | undefined
}) {
  return (
    <header className="space-y-2">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {session.title ?? `${session.owner}/${session.repo}#${session.number}`}
      </h1>
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <span className="font-mono">
          {session.owner}/{session.repo}#{session.number}
        </span>
        {session.author && <span>@{session.author}</span>}
        <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
          {session.agent}
        </span>
        {session.url && (
          <a
            href={session.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-blue-600"
          >
            <ExternalLink size={12} />
            open on GitHub
          </a>
        )}
      </div>
      <div className="flex items-center gap-3 pt-2">
        <StatusBadge status={session.status} />
        {session.status === 'submitted' && (
          <span className="text-xs text-gray-500">Submitted to GitHub.</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <fieldset
            className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400"
            aria-label="Rerun agent"
          >
            {AGENT_KINDS.map((k) => {
              const found = health?.agents[k].found ?? true
              const selected = rerunAgent === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => onRerunAgentChange(k)}
                  disabled={!found || rerunPending}
                  aria-pressed={selected}
                  title={found ? undefined : `${k} CLI not found in PATH`}
                  className={cn(
                    'px-2 py-1 rounded-md font-mono border transition-colors',
                    selected
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                      : 'border-gray-300 dark:border-gray-700 hover:border-blue-400',
                    !found && 'opacity-40 cursor-not-allowed',
                  )}
                >
                  {k}
                </button>
              )
            })}
          </fieldset>
          <button
            type="button"
            onClick={() => {
              const msg =
                session.status === 'running'
                  ? 'Delete this session? The running review will be canceled and all findings will be lost.'
                  : 'Delete this session and all findings? This cannot be undone.'
              if (confirm(msg)) onDelete()
            }}
            disabled={deletePending}
            aria-label="Delete session"
            title="Delete session"
            className="p-1.5 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
          >
            <Trash2 size={14} className={deletePending ? 'animate-pulse' : undefined} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (session.status === 'running') {
                if (
                  !confirm(
                    'Rerun while a review is still in progress? Current run will be canceled.',
                  )
                )
                  return
              }
              onRerun()
            }}
            disabled={rerunPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <RotateCw size={14} className={rerunPending ? 'animate-spin' : undefined} />
            Rerun
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={selectedCount === 0}
            className="px-4 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed"
            title={selectedCount === 0 ? 'Select at least one finding' : undefined}
          >
            Submit{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </button>
        </div>
      </div>
    </header>
  )
}

export function PRDetail() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [submitOpen, setSubmitOpen] = useState(false)
  const [rerunAgent, setRerunAgent] = useState<AgentKind | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.session(id),
    queryFn: () => api.getSession(id),
    enabled: !!id,
  })

  const { data: health } = useQuery({ queryKey: queryKeys.health, queryFn: api.health })

  const { data: diffFromEndpoint } = useQuery({
    queryKey: ['session', id, 'diff'],
    queryFn: () => api.getSessionDiff(id),
    enabled: !!id,
    retry: false,
  })

  useSSE(`/api/sessions/${id}/events`, () => {
    void qc.invalidateQueries({ queryKey: queryKeys.session(id) })
  })

  useEffect(() => {
    if (rerunAgent === null && data?.session.agent) setRerunAgent(data.session.agent)
  }, [rerunAgent, data?.session.agent])

  const rerun = useMutation({
    mutationFn: (kind: AgentKind) => api.rerunSession(id, { agent: kind }),
    onSuccess: ({ id: freshId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions })
      nav(`/pr/${freshId}`)
    },
  })

  const remove = useMutation({
    mutationFn: () => api.deleteSession(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions })
      qc.removeQueries({ queryKey: queryKeys.session(id) })
      nav('/')
    },
  })

  if (isLoading || !data) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-3 animate-pulse">
        <div className="h-5 w-2/3 bg-gray-200 dark:bg-gray-800 rounded" />
        <div className="h-4 w-1/3 bg-gray-200 dark:bg-gray-800 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded mt-6" />
      </div>
    )
  }

  const { session, findings } = data
  const inlineDiff = data.diff ?? diffFromEndpoint ?? null
  const activeFindings = findings.filter((f) => !f.archived)
  const selectedCount = activeFindings.filter((f) => f.selected).length
  const effectiveRerunAgent: AgentKind = rerunAgent ?? session.agent

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PRHeader
        session={session}
        selectedCount={selectedCount}
        onRerun={() => rerun.mutate(effectiveRerunAgent)}
        onSubmit={() => setSubmitOpen(true)}
        onDelete={() => remove.mutate()}
        rerunPending={rerun.isPending}
        deletePending={remove.isPending}
        rerunAgent={effectiveRerunAgent}
        onRerunAgentChange={setRerunAgent}
        health={health}
      />

      {session.error && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <div className="font-medium">Session error</div>
          <div className="mt-1">{session.error}</div>
        </div>
      )}

      {rerun.isError && (
        <div className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {rerun.error instanceof ApiError ? rerun.error.message : 'Rerun failed'}
        </div>
      )}

      {remove.isError && (
        <div className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {remove.error instanceof ApiError ? remove.error.message : 'Delete failed'}
        </div>
      )}

      {session.status === 'running' && activeFindings.length === 0 && (
        <div className="rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-4 py-6 text-sm text-blue-700 dark:text-blue-300 text-center">
          <Loader2 size={18} className="inline-block mr-2 animate-spin" />
          {session.agent} is reviewing… findings will stream in here as they're produced.
        </div>
      )}

      {session.status === 'ready' && activeFindings.length === 0 && (
        <div className="rounded-md border border-dashed border-gray-300 dark:border-gray-700 px-6 py-8 text-center">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            No issues found. Either the PR is clean, or the prompt missed something.
          </div>
          <div className="mt-3 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => rerun.mutate(effectiveRerunAgent)}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Rerun with {effectiveRerunAgent}
            </button>
          </div>
        </div>
      )}

      {activeFindings.length > 0 && (
        <FindingList findings={activeFindings} session={session} unifiedDiff={inlineDiff} />
      )}

      {submitOpen && <SubmitDrawer sessionId={id} onClose={() => setSubmitOpen(false)} />}
    </div>
  )
}
