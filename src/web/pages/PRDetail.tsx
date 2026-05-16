import type {
  AgentKind,
  Finding,
  HealthStatus,
  PrepCall,
  PrepStep,
  PRSession,
  SessionStatus,
} from '@shared/types'
import { AGENT_KINDS } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderGit2,
  RotateCw,
  Square,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'

import { ExportPopover } from '@/components/ExportPopover'
import { FilesChangedView } from '@/components/files-changed/FilesChangedView'
import { FindingsWorkspace } from '@/components/FindingsWorkspace'
import { RunStrip } from '@/components/RunStrip'
import { SubmitDrawer } from '@/components/SubmitDrawer'
import { TranscriptDrawer, useTranscriptDrawer } from '@/components/TranscriptDrawer'
import { Button, ConfirmAction, EmptyState, Tag } from '@/components/ui'
import { api, queryKeys, ApiError } from '@/lib/api'
import { buildFileAliasMap, canonicalFilePath, parseFileList } from '@/lib/diff-utils'
import { useSelectedFinding, useSubmitDrawer } from '@/lib/selection'
import { useSSE } from '@/lib/sse'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const STATUS_TONE: Record<SessionStatus, 'running' | 'success' | 'warning' | 'danger' | 'neutral'> =
  {
    running: 'running',
    // `pending` now means "review prep in progress" (gh fetches, prior-
    // context lookups, source prep). It behaves like running visually.
    pending: 'running',
    ready: 'success',
    failed: 'danger',
    submitted: 'neutral',
    archived: 'neutral',
    cancelled: 'neutral',
  }

function SourceKindBadge({ session }: { session: PRSession }) {
  const { t } = useTranslation()
  const kind = session.sourceKind
  if (!kind || kind === 'none') return null
  const isWorktree = kind === 'worktree'
  const label = t(isWorktree ? 'prdetail.sourceWorktreeLabel' : 'prdetail.sourceSnapshotLabel')
  const title = t(isWorktree ? 'prdetail.sourceWorktreeTitle' : 'prdetail.sourceSnapshotTitle')
  return (
    <span
      className="inline-flex items-center gap-1 text-meta text-ink-secondary"
      title={title}
      aria-label={title}
    >
      {label}
    </span>
  )
}

interface PRHeaderProps {
  session: PRSession
  // Non-archived findings on this session. Used by the Export popover.
  findings: Finding[]
  selectedCount: number
  // 1-based round number for the *current* session (first review = 1,
  // first rerun = 2, …). Computed by the parent from archived sessions
  // older than this one for the same PR.
  roundNumber: number
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
  findings,
  selectedCount,
  roundNumber,
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
  const { t } = useTranslation()
  return (
    <header className="space-y-4">
      <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Tag tone={STATUS_TONE[session.status]} data-status={session.status}>
          {t(`prdetail.status.${session.status}`)}
        </Tag>
        {roundNumber > 1 ? (
          <Tag tone="brand" title={t('prdetail.roundTitle')}>
            {t('prdetail.roundLabel', { n: roundNumber })}
          </Tag>
        ) : null}
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
            aria-label={t('prdetail.openOnGithub')}
            className="inline-flex items-center gap-1 text-meta text-ink-secondary transition-colors duration-180 ease-out-quart hover:text-brand"
          >
            <ExternalLink size={12} aria-hidden="true" />
            {t('prdetail.github')}
          </a>
        ) : null}
        {session.localRepoPath ? (
          <span
            className="inline-flex max-w-[44ch] items-center gap-1 font-mono text-meta text-ink-secondary"
            title={t('prdetail.localRepoLabel', { path: session.localRepoPath })}
            aria-label={t('prdetail.localRepoLabel', { path: session.localRepoPath })}
          >
            <FolderGit2 size={12} className="text-ink-muted shrink-0" aria-hidden="true" />
            <span className="truncate">{session.localRepoPath}</span>
          </span>
        ) : null}
        <SourceKindBadge session={session} />

        {justSwitched ? (
          <Tag tone="brand" className="animate-running-pulse">
            {t('prdetail.newRunStarted')}
          </Tag>
        ) : null}
        {session.status === 'submitted' ? (
          <span className="text-meta text-ink-secondary">{t('prdetail.submittedNote')}</span>
        ) : null}
      </div>

      <h1 className="text-display text-ink-primary">
        {session.title ?? `${session.owner}/${session.repo}#${session.number}`}
      </h1>

      <div className="flex items-center gap-4 flex-wrap">
        <fieldset className="flex items-center gap-1.5 text-meta text-ink-secondary">
          <legend className="sr-only">{t('prdetail.agentLegend')}</legend>
          <span className="mr-1 text-caps tracking-caps text-ink-muted uppercase">
            {t('prdetail.agentLabel')}
          </span>
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
              </button>
            )
          })}
        </fieldset>

        <div className="ml-auto flex items-center gap-2">
          {session.status === 'running' ? (
            <ConfirmAction
              title={t('prdetail.cancelTitle')}
              description={t('prdetail.cancelDesc')}
              confirmLabel={t('prdetail.cancelConfirm')}
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
                  aria-label={t('prdetail.cancelRunningAriaLabel')}
                >
                  <Square size={12} fill="currentColor" aria-hidden="true" />
                  {t('prdetail.cancel')}
                </Button>
              )}
            </ConfirmAction>
          ) : null}
          <ConfirmAction
            title={t('prdetail.deleteTitle')}
            description={
              session.status === 'running'
                ? t('prdetail.deleteDescRunning')
                : t('prdetail.deleteDescDefault')
            }
            confirmLabel={t('prdetail.delete')}
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
                aria-label={t('prdetail.deleteAriaLabel')}
              >
                <Trash2 size={12} aria-hidden="true" />
                {t('prdetail.delete')}
              </Button>
            )}
          </ConfirmAction>
          <span className="h-5 w-px bg-rule" aria-hidden="true" />
          {session.status === 'running' ? (
            <ConfirmAction
              title={t('prdetail.rerunRunningTitle')}
              description={t('prdetail.rerunRunningDesc')}
              confirmLabel={t('prdetail.rerunConfirm')}
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
                  {t('prdetail.rerun')}
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
              {t('prdetail.rerun')}
            </Button>
          )}
          <ExportPopover session={session} findings={findings} roundNumber={roundNumber} />
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={onSubmit}
            disabled={selectedCount === 0}
            title={selectedCount === 0 ? t('prdetail.submitTitleZero') : undefined}
          >
            {selectedCount > 0
              ? `${t('prdetail.submit')} · ${selectedCount}`
              : t('prdetail.submit')}
          </Button>
        </div>
      </div>
    </header>
  )
}

interface ExtraContextPanelProps {
  base: string | null
  draft: string | null
  editing: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onChange: (value: string) => void
}

function ExtraContextPanel({
  base,
  draft,
  editing,
  expanded,
  onToggleExpanded,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onChange,
}: ExtraContextPanelProps) {
  const { t } = useTranslation()
  const hasBase = !!base && base.trim().length > 0
  const overridePending = !editing && draft !== null && draft !== (base ?? '')
  const draftValue = draft ?? base ?? ''

  if (!hasBase && !editing && draft === null) {
    return (
      <button
        type="button"
        onClick={onStartEdit}
        className="inline-flex items-center gap-1.5 text-meta text-ink-secondary hover:text-ink-primary transition-colors duration-180 ease-out-quart"
        aria-label={t('prdetail.extraContext.addAriaLabel')}
      >
        <FileText size={14} aria-hidden="true" />
        <span>{t('prdetail.extraContext.addLabel')}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    )
  }

  if (editing) {
    return (
      <div className="rounded-lg bg-raised border border-rule p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-caps tracking-caps text-ink-muted uppercase">
            {t('prdetail.extraContext.editorHeader')}
          </span>
          <div className="flex items-center gap-2 text-meta">
            <button
              type="button"
              onClick={onCancelEdit}
              className="text-ink-muted hover:text-ink-secondary transition-colors duration-180 ease-out-quart"
            >
              {t('prdetail.extraContext.cancel')}
            </button>
            <button
              type="button"
              onClick={onSaveEdit}
              className="text-brand hover:opacity-80 transition-opacity duration-180 ease-out-quart"
            >
              {t('prdetail.extraContext.save')}
            </button>
          </div>
        </div>
        <textarea
          aria-label={t('prdetail.extraContext.ariaLabel')}
          value={draftValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('prdetail.extraContext.placeholder')}
          className="w-full min-h-[8rem] p-3 font-mono text-code rounded-md bg-canvas border border-rule text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-brand transition-colors duration-180 ease-out-quart resize-y"
          spellCheck={false}
        />
      </div>
    )
  }

  // Read-only view (collapsed or expanded).
  return (
    <div className="rounded-lg border border-rule bg-raised/40">
      <div className="flex items-center gap-2 px-3 py-2 text-meta text-ink-secondary">
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={t('prdetail.extraContext.toggleAriaLabel')}
          className="flex flex-1 min-w-0 items-center gap-2 hover:text-ink-primary transition-colors duration-180 ease-out-quart"
        >
          {expanded ? (
            <ChevronDown size={14} className="shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight size={14} className="shrink-0" aria-hidden="true" />
          )}
          <FileText size={14} className="shrink-0 text-ink-muted" aria-hidden="true" />
          <span className="text-caps tracking-caps text-ink-muted uppercase">
            {t('prdetail.extraContext.label')}
          </span>
          {overridePending ? (
            <Tag tone="brand">{t('prdetail.extraContext.editedTag')}</Tag>
          ) : hasBase ? (
            <span className="ml-1 truncate text-ink-muted text-meta font-mono">
              {(base as string).slice(0, 80).replace(/\s+/g, ' ')}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onStartEdit}
          aria-label={t('prdetail.extraContext.editAriaLabel')}
          className="text-meta text-ink-muted hover:text-ink-secondary transition-colors duration-180 ease-out-quart"
        >
          {t('prdetail.extraContext.edit')}
        </button>
      </div>
      {expanded && hasBase ? (
        <pre className="px-3 pb-3 pt-0 font-mono text-code text-ink-secondary whitespace-pre-wrap break-words">
          {base}
        </pre>
      ) : null}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'relative px-4 py-2.5 text-meta font-medium flex items-center gap-2 transition-colors duration-180 ease-out-quart',
        active ? 'text-ink-primary' : 'text-ink-secondary hover:text-ink-primary',
      )}
    >
      {label}
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] text-[10.5px] font-mono tabular-nums border',
          active ? 'border-brand text-brand bg-canvas' : 'border-rule text-ink-muted bg-raised',
        )}
      >
        {count}
      </span>
      {active ? (
        <span aria-hidden="true" className="absolute left-0 right-0 -bottom-px h-[2px] bg-brand" />
      ) : null}
    </button>
  )
}

export function PRDetail() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const submitDrawer = useSubmitDrawer()
  const transcriptDrawer = useTranscriptDrawer()
  const { setSelectedFindingDbId } = useSelectedFinding()
  const toast = useToast()
  const topStackRef = useRef<HTMLDivElement | null>(null)
  const [rerunAgent, setRerunAgent] = useState<AgentKind | null>(null)
  const [justSwitched, setJustSwitched] = useState(false)
  const [agentChunks, setAgentChunks] = useState<string[]>([])
  const [prepSteps, setPrepSteps] = useState<PrepStep[]>([])
  const [prepCalls, setPrepCalls] = useState<PrepCall[]>([])
  // null = no override → server carries the previous session's extraPrompt as-is.
  // string (including '') = explicit override sent on rerun.
  const [extraDraft, setExtraDraft] = useState<string | null>(null)
  const [extraEditing, setExtraEditing] = useState(false)
  const [extraExpanded, setExtraExpanded] = useState(false)
  // Files-changed tab state. Default to 'files' so users can preview the diff
  // immediately once prep completes, even while the agent is still streaming.
  const [activeTab, setActiveTab] = useState<'findings' | 'files'>('files')
  const [filesTabSelectedPath, setFilesTabSelectedPath] = useState<string | null>(null)
  // Mirror to a ref so the SSE callback can read the latest value without
  // re-subscribing on every state change.
  const selectedFileRef = useRef<string | null>(null)
  useEffect(() => {
    selectedFileRef.current = filesTabSelectedPath
  }, [filesTabSelectedPath])
  // Rename-aware path map, kept in a ref so the SSE handler can normalize an
  // incoming finding's `file` (which may be the old path) before comparing it
  // to the currently-selected canonical path.
  const fileAliasMapRef = useRef<Map<string, string>>(new Map())
  const activeTabRef = useRef<'findings' | 'files'>(activeTab)
  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.session(id),
    queryFn: () => api.getSession(id),
    enabled: !!id,
  })

  // Lift diff fetching so both tabs (Findings detail pane + Files changed
  // tree/diff) share a single response. Enabled once prep is done — the
  // diff.cache file is written before the agent runs.
  const { data: sessionDiff } = useQuery({
    queryKey: ['session', id, 'diff'] as const,
    queryFn: () => api.getSessionDiff(id),
    enabled: !!id && !!data && data.session.status !== 'pending',
    retry: false,
  })

  const { data: health } = useQuery({ queryKey: queryKeys.health, queryFn: api.health })
  // Used to compute "round N" — counts prior archived sessions for the
  // same PR. Cached under the sessions key so it shares with the sidebar.
  const { data: allSessions } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: api.listSessions,
  })

  // Once a session ends, the live agent-output SSE stream is gone. For a
  // terminal session with no live chunks (page reloaded / opened after the
  // run), replay the transcript from the persisted agent.log instead.
  const { data: diskTranscript } = useQuery({
    queryKey: queryKeys.sessionTranscript(id),
    queryFn: () => api.getSessionTranscript(id),
    enabled:
      !!data &&
      agentChunks.length === 0 &&
      data.session.status !== 'running' &&
      data.session.status !== 'pending',
  })

  // Replay prep.log on mount / id change so refresh during or after prep
  // shows the phase timeline + captured gh stdout. Cached per session id so
  // tab switches don't refetch. Backfill only seeds state when the local
  // SSE-driven state is still empty (live events take precedence).
  const { data: diskPrepLog } = useQuery({
    queryKey: queryKeys.sessionPrepLog(id),
    queryFn: () => api.getSessionPrepLog(id),
    enabled: !!data,
  })
  useEffect(() => {
    if (!diskPrepLog) return
    if (Array.isArray(diskPrepLog.phases)) {
      setPrepSteps((prev) => (prev.length === 0 ? diskPrepLog.phases : prev))
    }
    if (Array.isArray(diskPrepLog.calls)) {
      setPrepCalls((prev) => (prev.length === 0 ? diskPrepLog.calls : prev))
    }
  }, [diskPrepLog])

  useSSE(`/api/sessions/${id}/events`, (e) => {
    if (e.type === 'agent-output') {
      setAgentChunks((prev) => [...prev, e.chunk])
      return
    }
    // Server-emitted prep phases share the `prep:` prefix. Agent runtime
    // emits its own `progress` events too (stream-json phases for claude,
    // line phases for codex) — we ignore those here.
    if (e.type === 'progress' && e.phase.startsWith('prep:')) {
      const step: PrepStep = { phase: e.phase, ts: Date.now() }
      if (e.detail !== undefined) step.detail = e.detail
      setPrepSteps((prev) => [...prev, step])
    }
    if (e.type === 'prep-output') {
      const call: PrepCall = {
        phase: e.phase,
        command: e.command,
        stdout: e.stdout,
        stderr: e.stderr,
        exitCode: e.exitCode,
        durationMs: e.durationMs,
        ts: e.ts,
      }
      setPrepCalls((prev) => [...prev, call])
    }
    // While the user is on the Files changed tab, notify when a new finding
    // lands in a file they're not currently viewing so they can jump to it.
    // Normalize through the alias map first so rename-file findings (which
    // may carry the old path) compare against the canonical display path.
    if (e.type === 'finding-added' && activeTabRef.current === 'files' && e.finding.file) {
      const canonical = canonicalFilePath(fileAliasMapRef.current, e.finding.file)
      if (canonical !== selectedFileRef.current) {
        toast.push({
          title: e.finding.title,
          file: canonical,
          ...(e.finding.line != null ? { line: e.finding.line } : {}),
          severity: e.finding.severity,
          onClick: () => setFilesTabSelectedPath(canonical),
          persistent: e.finding.severity === 'must',
        })
      }
    }
    void qc.invalidateQueries({ queryKey: queryKeys.session(id) })
  })

  useEffect(() => {
    if (data?.session.agent) setRerunAgent(data.session.agent)
  }, [id, data?.session.agent])

  useEffect(() => {
    topStackRef.current?.scrollTo?.({ top: 0 })
    submitDrawer.close()
    setSelectedFindingDbId(null)
    setAgentChunks([])
    setPrepSteps([])
    setPrepCalls([])
    setExtraDraft(null)
    setExtraEditing(false)
    setExtraExpanded(false)
  }, [id])

  useEffect(() => {
    if (!justSwitched) return
    const tmr = setTimeout(() => setJustSwitched(false), 2500)
    return () => clearTimeout(tmr)
  }, [justSwitched])

  // Global ⌘J / Ctrl+J toggles the transcript drawer. preventDefault is needed
  // on Chrome to suppress the built-in downloads page on Ctrl+J. On Mac, ⌘J
  // has no native browser binding so preventDefault is harmless.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key !== 'j' && e.key !== 'J') return
      if (e.shiftKey || e.altKey) return
      e.preventDefault()
      transcriptDrawer.toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [transcriptDrawer.toggle])

  const rerun = useMutation({
    mutationFn: (kind: AgentKind) => {
      const body: { agent: AgentKind; extraPrompt?: string } = { agent: kind }
      if (extraDraft !== null) body.extraPrompt = extraDraft
      return api.rerunSession(id, body)
    },
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
      <div className="px-8 py-10 max-w-3xl space-y-4" aria-label={t('prdetail.loadingAriaLabel')}>
        <div className="text-caps tracking-caps text-ink-muted uppercase">{t('app.loading')}</div>
        <div className="h-8 w-2/3 bg-raised rounded" />
        <div className="h-px w-full bg-rule" />
        <div className="h-3 w-full bg-raised/70 rounded" />
        <div className="h-3 w-5/6 bg-raised/70 rounded" />
      </div>
    )
  }

  const { session, findings } = data
  // Live chunks win while/after watching a run; fall back to the disk replay.
  const replayChunks = Array.isArray(diskTranscript?.chunks) ? diskTranscript.chunks : []
  const transcriptChunks =
    agentChunks.length > 0
      ? agentChunks
      : diskTranscript?.truncated
        ? [t('transcriptDrawer.truncatedNotice'), ...replayChunks]
        : replayChunks
  const activeFindings = findings.filter((f) => !f.archived)
  const selectedCount = activeFindings.filter((f) => f.selected).length
  const effectiveRerunAgent: AgentKind = rerunAgent ?? session.agent
  // Round N = 1 + (archived sessions older than this one for the same PR).
  // The current session is non-archived (running/ready/submitted/etc) at
  // load time; we only count strictly-prior runs.
  const roundNumber = Array.isArray(allSessions)
    ? 1 +
      allSessions.filter(
        (s) =>
          s.owner === session.owner &&
          s.repo === session.repo &&
          s.number === session.number &&
          s.status === 'archived' &&
          s.createdAt < session.createdAt,
      ).length
    : 1

  const unifiedDiff = sessionDiff ?? null
  const parsedFiles = unifiedDiff ? parseFileList(unifiedDiff) : []
  const fileCount = parsedFiles.length
  // Keep the alias-map ref in sync with the latest diff so the SSE callback
  // (which holds the ref) sees fresh data without re-subscribing.
  fileAliasMapRef.current = buildFileAliasMap(parsedFiles)

  const emptyFindingsCopy: { title: string; body: string } | null =
    activeFindings.length === 0
      ? session.status === 'running' || session.status === 'pending'
        ? {
            title: t('prdetail.findingsStreamingTitle'),
            body: t('prdetail.findingsStreamingBody'),
          }
        : session.status === 'failed'
          ? {
              title: t('prdetail.findingsFailedTitle'),
              body: t('prdetail.findingsFailedBody'),
            }
          : session.status === 'cancelled'
            ? {
                title: t('prdetail.findingsCancelledTitle'),
                body: t('prdetail.findingsCancelledBody'),
              }
            : session.status === 'submitted'
              ? {
                  title: t('prdetail.findingsSubmittedTitle'),
                  body: t('prdetail.findingsSubmittedBody'),
                }
              : session.status === 'archived'
                ? {
                    title: t('prdetail.findingsArchivedTitle'),
                    body: t('prdetail.findingsArchivedBody'),
                  }
                : null
      : null

  const findingsTabBody =
    session.status === 'ready' && activeFindings.length === 0 ? (
      <div className="px-8 py-10">
        <EmptyState
          eyebrow={t('prdetail.noIssuesEyebrow')}
          title={t('prdetail.noIssuesTitle')}
          body={t('prdetail.noIssuesBody')}
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => rerun.mutate(effectiveRerunAgent)}
            >
              {t('prdetail.rerunWith', { agent: effectiveRerunAgent })}
            </Button>
          }
        />
      </div>
    ) : emptyFindingsCopy ? (
      <div className="px-8 py-10">
        <EmptyState title={emptyFindingsCopy.title} body={emptyFindingsCopy.body} />
      </div>
    ) : (
      <FindingsWorkspace
        findings={activeFindings}
        session={session}
        unifiedDiff={unifiedDiff}
        selectedCount={selectedCount}
      />
    )

  const filesTabBody = (
    <FilesChangedView
      session={session}
      findings={activeFindings}
      unifiedDiff={unifiedDiff}
      selectedPath={filesTabSelectedPath}
      onSelectPath={setFilesTabSelectedPath}
      onOpenFindingInPanel={(dbId) => {
        setSelectedFindingDbId(dbId)
        setActiveTab('findings')
      }}
    />
  )

  const tabsBar = (
    <div className="shrink-0 flex items-stretch border-b border-rule bg-main px-2">
      <TabButton
        active={activeTab === 'findings'}
        onClick={() => setActiveTab('findings')}
        label={t('filesChanged.tabFindings')}
        count={activeFindings.length}
      />
      <TabButton
        active={activeTab === 'files'}
        onClick={() => setActiveTab('files')}
        label={t('filesChanged.tabFiles')}
        count={fileCount}
      />
    </div>
  )

  return (
    <div className="h-full flex flex-col min-h-0">
      <div ref={topStackRef} className="shrink-0 px-8 pt-8 pb-6 space-y-6 border-b border-rule">
        <PRHeader
          session={session}
          findings={activeFindings}
          selectedCount={selectedCount}
          roundNumber={roundNumber}
          onRerun={() => rerun.mutate(effectiveRerunAgent)}
          onSubmit={submitDrawer.open}
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

        <ExtraContextPanel
          base={session.extraPrompt}
          draft={extraDraft}
          editing={extraEditing}
          expanded={extraExpanded}
          onToggleExpanded={() => setExtraExpanded((v) => !v)}
          onStartEdit={() => {
            setExtraDraft(extraDraft ?? session.extraPrompt ?? '')
            setExtraEditing(true)
            setExtraExpanded(true)
          }}
          onCancelEdit={() => {
            setExtraEditing(false)
            setExtraDraft(null)
          }}
          onSaveEdit={() => setExtraEditing(false)}
          onChange={(v) => setExtraDraft(v)}
        />

        {session.error ? (
          <div className="border-l-[1px] border-severity-must pl-4 py-2">
            <div className="text-caps tracking-caps text-severity-must uppercase mb-1">
              {t('prdetail.sessionError')}
            </div>
            <div className="text-body text-ink-primary">{session.error}</div>
          </div>
        ) : null}

        {rerun.isError ? (
          <div className="text-meta text-severity-must">
            {rerun.error instanceof ApiError ? rerun.error.message : t('prdetail.rerunFailed')}
          </div>
        ) : null}

        {remove.isError ? (
          <div className="text-meta text-severity-must">
            {remove.error instanceof ApiError ? remove.error.message : t('prdetail.deleteFailed')}
          </div>
        ) : null}

        {cancel.isError ? (
          <div className="text-meta text-severity-must">
            {cancel.error instanceof ApiError ? cancel.error.message : t('prdetail.cancelFailed')}
          </div>
        ) : null}
      </div>

      <RunStrip
        session={session}
        prepSteps={prepSteps}
        findingsCount={activeFindings.length}
        transcriptOpen={transcriptDrawer.open}
        onToggleTranscript={transcriptDrawer.toggle}
      />

      {tabsBar}

      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === 'findings' ? findingsTabBody : filesTabBody}
      </div>

      <TranscriptDrawer
        chunks={transcriptChunks}
        prepSteps={prepSteps}
        prepCalls={prepCalls}
        status={session.status}
        open={transcriptDrawer.open}
        onToggle={transcriptDrawer.toggle}
        onClose={() => transcriptDrawer.setOpen(false)}
      />

      {submitDrawer.isOpen ? <SubmitDrawer sessionId={id} onClose={submitDrawer.close} /> : null}
    </div>
  )
}
