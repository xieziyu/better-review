import type { AgentKind, HealthStatus, PRSession, SessionStatus } from '@shared/types'
import { AGENT_KINDS } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FolderGit2, RotateCw, Square, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { AgentOutputPanel } from '@/components/AgentOutputPanel'
import { FindingList } from '@/components/FindingList'
import { SubmitDrawer } from '@/components/SubmitDrawer'
import { Button, ConfirmAction, EmptyState, Tag } from '@/components/ui'
import { api, queryKeys, ApiError } from '@/lib/api'
import { useSSE } from '@/lib/sse'
import { cn } from '@/lib/utils'

const STATUS_TONE: Record<SessionStatus, 'running' | 'success' | 'warning' | 'danger' | 'neutral'> =
  {
    running: 'running',
    pending: 'warning',
    ready: 'success',
    failed: 'danger',
    submitted: 'neutral',
    archived: 'neutral',
    cancelled: 'neutral',
  }

const STATUS_LABEL: Record<SessionStatus, string> = {
  running: 'Running',
  pending: 'Pending',
  ready: 'Ready',
  failed: 'Failed',
  submitted: 'Submitted',
  archived: 'Archived',
  cancelled: 'Cancelled',
}

interface PRHeaderProps {
  session: PRSession
  selectedCount: number
  onRerun: () => void
  onSubmit: () => void
  onDelete: () => void
  onCancel: () => void
  rerunPending: boolean
  deletePending: boolean
  cancelPending: boolean
  rerunAgent: AgentKind
  onRerunAgentChange: (kind: AgentKind) => void
  health: HealthStatus | undefined
  justSwitched: boolean
}

function PRHeader({
  session,
  selectedCount,
  onRerun,
  onSubmit,
  onDelete,
  onCancel,
  rerunPending,
  deletePending,
  cancelPending,
  rerunAgent,
  onRerunAgentChange,
  health,
  justSwitched,
}: PRHeaderProps) {
  return (
    <header className="space-y-4">
      <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Tag tone={STATUS_TONE[session.status]} data-status={session.status}>
          {STATUS_LABEL[session.status]}
        </Tag>
        <span
          className="min-w-0 font-mono text-meta text-ink-secondary tabular-nums"
          aria-label={`${session.owner}/${session.repo}#${session.number}`}
        >
          <span className="inline-block max-w-[38ch] truncate align-bottom">
            {session.owner}/{session.repo}
          </span>
          <span className="text-ink-muted">#{session.number}</span>
        </span>
        {session.author ? (
          <span className="font-mono text-meta text-ink-muted">@{session.author}</span>
        ) : null}
        {session.url ? (
          <a
            href={session.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open PR on GitHub"
            className="inline-flex items-center gap-1 text-meta text-ink-secondary transition-colors duration-180 ease-out-quart hover:text-brand"
          >
            <ExternalLink size={12} aria-hidden="true" />
            GitHub
          </a>
        ) : null}
        {session.localRepoPath ? (
          <span
            className="inline-flex max-w-[44ch] items-center gap-1 font-mono text-meta text-ink-secondary"
            title={`Local repo: ${session.localRepoPath}`}
            aria-label={`Local repo: ${session.localRepoPath}`}
          >
            <FolderGit2 size={12} className="text-ink-muted shrink-0" aria-hidden="true" />
            <span className="truncate">{session.localRepoPath}</span>
          </span>
        ) : null}
        {justSwitched ? (
          <Tag tone="brand" className="animate-running-pulse">
            new run started
          </Tag>
        ) : null}
        {session.status === 'submitted' ? (
          <span className="text-meta text-ink-secondary">Submitted to GitHub.</span>
        ) : null}
      </div>

      <h1 className="text-display text-ink-primary">
        {session.title ?? `${session.owner}/${session.repo}#${session.number}`}
      </h1>

      <div className="flex items-center gap-4 flex-wrap">
        <fieldset className="flex items-center gap-1.5 text-meta text-ink-secondary">
          <legend className="sr-only">Review agent</legend>
          <span className="mr-1 text-caps tracking-caps text-ink-muted uppercase">Agent</span>
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
                  'h-7 px-2.5 rounded-sm border font-mono text-meta tabular-nums transition-colors duration-180 ease-out-quart',
                  selected
                    ? 'border-ink-primary bg-ink-primary text-canvas'
                    : 'border-rule bg-raised/25 text-ink-secondary hover:text-ink-primary hover:bg-raised hover:border-ink-muted',
                  !found && 'opacity-40 cursor-not-allowed',
                )}
              >
                {k}
              </button>
            )
          })}
        </fieldset>

        <div className="ml-auto flex items-center gap-2">
          {session.status === 'running' ? (
            <ConfirmAction
              title="Cancel running review?"
              description="Collected findings will be kept."
              confirmLabel="Cancel run"
              onConfirm={onCancel}
              disabled={cancelPending}
            >
              {(requestConfirm) => (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={requestConfirm}
                  disabled={cancelPending}
                  aria-label="Cancel running review"
                >
                  <Square size={12} fill="currentColor" aria-hidden="true" />
                  Cancel
                </Button>
              )}
            </ConfirmAction>
          ) : null}
          <ConfirmAction
            title="Delete this session?"
            description={
              session.status === 'running'
                ? 'The running review will be canceled and all findings will be lost.'
                : 'All findings will be removed. This cannot be undone.'
            }
            confirmLabel="Delete"
            onConfirm={onDelete}
            disabled={deletePending}
          >
            {(requestConfirm) => (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={requestConfirm}
                disabled={deletePending}
                aria-label="Delete session"
              >
                <Trash2 size={12} aria-hidden="true" />
                Delete
              </Button>
            )}
          </ConfirmAction>
          <span className="h-5 w-px bg-rule" aria-hidden="true" />
          {session.status === 'running' ? (
            <ConfirmAction
              title="Rerun while review is still in progress?"
              description="The current run will be canceled before starting a new one."
              confirmLabel="Rerun"
              onConfirm={onRerun}
              disabled={rerunPending}
            >
              {(requestConfirm) => (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={requestConfirm}
                  disabled={rerunPending}
                >
                  <RotateCw size={12} className={rerunPending ? 'animate-spin' : undefined} />
                  Rerun
                </Button>
              )}
            </ConfirmAction>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRerun}
              disabled={rerunPending}
            >
              <RotateCw size={12} className={rerunPending ? 'animate-spin' : undefined} />
              Rerun
            </Button>
          )}
          <Button
            type="button"
            variant="ink"
            size="md"
            onClick={onSubmit}
            disabled={selectedCount === 0}
            title={selectedCount === 0 ? 'Select at least one finding' : undefined}
          >
            Submit{selectedCount > 0 ? ` · ${selectedCount}` : ''}
          </Button>
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
  const [justSwitched, setJustSwitched] = useState(false)
  const [agentChunks, setAgentChunks] = useState<string[]>([])

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

  useSSE(`/api/sessions/${id}/events`, (e) => {
    if (e.type === 'agent-output') {
      setAgentChunks((prev) => [...prev, e.chunk])
      return
    }
    void qc.invalidateQueries({ queryKey: queryKeys.session(id) })
  })

  useEffect(() => {
    if (data?.session.agent) setRerunAgent(data.session.agent)
  }, [id, data?.session.agent])

  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 })
    setSubmitOpen(false)
    setAgentChunks([])
  }, [id])

  useEffect(() => {
    if (!justSwitched) return
    const t = setTimeout(() => setJustSwitched(false), 2500)
    return () => clearTimeout(t)
  }, [justSwitched])

  const rerun = useMutation({
    mutationFn: (kind: AgentKind) => api.rerunSession(id, { agent: kind }),
    onSuccess: ({ id: freshId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions })
      setJustSwitched(true)
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

  const cancel = useMutation({
    mutationFn: () => api.cancelSession(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.session(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.sessions })
    },
  })

  if (isLoading || !data) {
    return (
      <div className="px-8 py-10 max-w-3xl space-y-4">
        <div className="text-caps tracking-caps text-ink-muted uppercase">Loading</div>
        <div className="h-8 w-2/3 bg-raised rounded" />
        <div className="h-px w-full bg-rule" />
        <div className="h-3 w-full bg-raised/70 rounded" />
        <div className="h-3 w-5/6 bg-raised/70 rounded" />
      </div>
    )
  }

  const { session, findings } = data
  const inlineDiff = data.diff ?? diffFromEndpoint ?? null
  const activeFindings = findings.filter((f) => !f.archived)
  const selectedCount = activeFindings.filter((f) => f.selected).length
  const effectiveRerunAgent: AgentKind = rerunAgent ?? session.agent

  return (
    <div className="px-8 py-8 mx-auto" style={{ width: 'clamp(720px, 84vw, 980px)' }}>
      <div className="space-y-8">
        <PRHeader
          session={session}
          selectedCount={selectedCount}
          onRerun={() => rerun.mutate(effectiveRerunAgent)}
          onSubmit={() => setSubmitOpen(true)}
          onDelete={() => remove.mutate()}
          onCancel={() => cancel.mutate()}
          rerunPending={rerun.isPending}
          deletePending={remove.isPending}
          cancelPending={cancel.isPending}
          rerunAgent={effectiveRerunAgent}
          onRerunAgentChange={setRerunAgent}
          health={health}
          justSwitched={justSwitched}
        />

        <AgentOutputPanel chunks={agentChunks} status={session.status} />

        {session.error ? (
          <div className="border-l-[1px] border-severity-must pl-4 py-2">
            <div className="text-caps tracking-caps text-severity-must uppercase mb-1">
              Session error
            </div>
            <div className="text-body text-ink-primary">{session.error}</div>
          </div>
        ) : null}

        {rerun.isError ? (
          <div className="text-meta text-severity-must">
            {rerun.error instanceof ApiError ? rerun.error.message : 'Rerun failed'}
          </div>
        ) : null}

        {remove.isError ? (
          <div className="text-meta text-severity-must">
            {remove.error instanceof ApiError ? remove.error.message : 'Delete failed'}
          </div>
        ) : null}

        {cancel.isError ? (
          <div className="text-meta text-severity-must">
            {cancel.error instanceof ApiError ? cancel.error.message : 'Cancel failed'}
          </div>
        ) : null}

        {session.status === 'running' && activeFindings.length === 0 ? (
          <div className="border-t border-rule pt-6 flex items-center gap-3 text-ink-secondary">
            <span
              className="size-1.5 rounded-full bg-accent-running animate-running-pulse"
              aria-hidden="true"
            />
            <span className="text-body">
              {session.agent} is reviewing. Findings will stream in here as they're produced.
            </span>
          </div>
        ) : null}

        {session.status === 'ready' && activeFindings.length === 0 ? (
          <EmptyState
            eyebrow="Ready"
            title="No issues found"
            body="Either the PR is clean, or the prompt missed something. Rerun to get a different angle."
            action={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => rerun.mutate(effectiveRerunAgent)}
              >
                Rerun with {effectiveRerunAgent}
              </Button>
            }
          />
        ) : null}

        {activeFindings.length > 0 ? (
          <FindingList findings={activeFindings} session={session} unifiedDiff={inlineDiff} />
        ) : null}

        {selectedCount > 0 ? (
          <div className="border-t border-rule pt-3 text-caps tracking-caps text-ink-muted uppercase">
            <span className="text-ink-secondary">{selectedCount} selected</span>
          </div>
        ) : null}

        {submitOpen ? <SubmitDrawer sessionId={id} onClose={() => setSubmitOpen(false)} /> : null}
      </div>
    </div>
  )
}
