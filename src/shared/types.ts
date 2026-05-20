import type { FindingFromAgent, Severity } from './findings-schema'

export type SessionStatus =
  | 'running'
  | 'ready'
  | 'failed'
  | 'submitted'
  | 'archived'
  | 'pending'
  | 'cancelled'

// Array order doubles as the fallback priority used by
// `pickEffectiveDefaultAgent` when the configured defaultAgent is missing
// locally and the user hasn't explicitly chosen one. Reorder with care.
export const AGENT_KINDS = ['codex', 'claude', 'pi'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

export const LANGUAGES = ['en', 'zh-CN'] as const
export type Language = (typeof LANGUAGES)[number]

// What kind of PR-head source tree the agent reads while reviewing:
// - 'worktree': a git worktree of the user's pinned local clone, checked out at
//   the PR head SHA. Full repo, full files-at-head fidelity.
// - 'snapshot': files touched by the diff fetched at the PR head SHA via
//   `gh api .../contents`. Partial — no callers, no siblings.
// - 'none':     no source context, agent only sees the diff. (legacy mode /
//   when both prep paths failed.)
export type SourceKind = 'worktree' | 'snapshot' | 'none'

export interface PRSession {
  id: string
  owner: string
  repo: string
  number: number
  title: string | null
  author: string | null
  url: string | null
  baseRef: string | null
  headRef: string | null
  status: SessionStatus
  agent: AgentKind
  createdAt: number
  updatedAt: number
  workdir: string
  localRepoPath: string | null
  sourceKind: SourceKind | null
  sourceRefName: string | null
  promptUsed: string
  extraPrompt: string | null
  headSha: string | null
  error: string | null
}

export interface RecentRepo {
  path: string
  lastUsedAt: number
  useCount: number
  matchedCurrentRepo: boolean
}

export type FindingSource = 'agent' | 'manual'

export interface Finding extends FindingFromAgent {
  dbId: string
  sessionId: string
  ord: number
  selected: boolean
  edited: boolean
  archived: boolean
  createdAt: number
  source: FindingSource
}

export type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'

export interface Submission {
  id: string
  sessionId: string
  event: ReviewEvent
  githubUrl: string | null
  githubReviewId: number | null
  payloadJson: string
  findingIds: string[]
  submittedAt: number
  error: string | null
}

// One row per inline comment we posted to GitHub from a submission. Maps
// the finding that generated it to the resulting GitHub comment id; used by
// submit-dedup (skip already-posted comments) and rerun-context (recover
// which review comments were ours without refetching).
export interface SubmissionComment {
  id: string
  submissionId: string
  findingDbId: string | null
  githubCommentId: number | null
  file: string | null
  line: number | null
  startLine: number | null
  title: string
  body: string
  createdAt: number
}

export interface AgentHealth {
  found: boolean
  path?: string
}

export interface HealthStatus {
  ok: boolean
  agents: Record<AgentKind, AgentHealth>
  defaultAgent: AgentKind
  gh: { found: boolean; path?: string; authed: boolean }
  fs: { folderPicker: { supported: boolean } }
  daemon: {
    pid: number
    port: number
    startedAt: number
    home: string
    logPath: string
    version: string
  }
}

// User-editable runtime configuration. Mirrors the writable subset of the
// server-side `Config` zod schema; kept here so the web bundle does not need
// to import zod-derived types from the server.
export interface AppConfig {
  port: number
  maxConcurrentReviews: number
  stallMinutes: number
  defaultAgent: AgentKind
  perPRGCDays: number
  language: Language
}

export type SSEEvent =
  | { type: 'progress'; sessionId: string; phase: string; detail?: string }
  | { type: 'agent-output'; sessionId: string; chunk: string; ts: number }
  | {
      type: 'prep-output'
      sessionId: string
      phase: string
      command: string[]
      stdout: string
      stderr: string
      exitCode: number | null
      durationMs: number
      ts: number
    }
  | { type: 'finding-added'; sessionId: string; finding: Finding }
  | { type: 'finding-updated'; sessionId: string; finding: Finding }
  | { type: 'status-changed'; sessionId: string; status: SessionStatus; error?: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'done'; sessionId: string }
  | { type: 'shutting-down' }

/**
 * One observed `prep:*` progress event, buffered client-side and replayed by
 * the run-progress UI. `ts` is the client-side Date.now() at receive time,
 * not the server emit time — used purely for stable React keys.
 */
export interface PrepStep {
  phase: string
  detail?: string
  ts: number
}

/**
 * One captured `gh` invocation that occurred during prep, tagged with the
 * active prep phase. Mirrors the `prep-output` SSE event payload so the same
 * shape works for live append AND for the `/api/sessions/:id/prep-log`
 * backfill on refresh. Stored in `<workdir>/prep.log` as JSONL.
 */
export interface PrepCall {
  phase: string
  command: string[]
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  ts: number
}

export interface CreateSessionRequest {
  prInput: string
  agent?: AgentKind
  localRepoPath?: string
  // Optional free-form notes attached to this single review (PRD excerpts,
  // judgment guidance, etc.). Merged into the rendered prompt; persisted on
  // the session so reruns can reuse or edit it.
  extraPrompt?: string
}
export interface RerunSessionRequest {
  agent?: AgentKind
  // When omitted, the rerun reuses the previous session's `extraPrompt` as-is.
  // When provided (including the empty string), it overrides — the empty
  // string clears the carry-over.
  extraPrompt?: string
}
export interface SubmitRequest {
  event: ReviewEvent
  body?: string
}
export interface UpdateFindingRequest {
  severity?: Severity
  title?: string
  body?: string
  suggestion?: string | null
  file?: string | null
  line?: number | null
  startLine?: number | null
}
export interface SelectFindingRequest {
  selected: boolean
}
export type PromptScope = 'global' | 'project'
export type RulesSource = PromptScope | 'builtin'
export interface PromptScopeState {
  exists: boolean
  content: string | null
  // Absolute path of the override file. Null only for the project scope when
  // no repo is selected — there is no project file to point at yet.
  path: string | null
}
export interface PromptStateResponse {
  // The local repo the project scope resolved against, echoed back from the
  // request. Null when no repo was provided.
  repo: string | null
  framework: { content: string }
  rules: {
    effective: { source: RulesSource; content: string; path: string | null }
    scopes: {
      global: PromptScopeState
      project: PromptScopeState
    }
  }
}
