import type { FindingFromAgent, Severity } from './findings-schema'

export type SessionStatus =
  | 'running'
  | 'ready'
  | 'failed'
  | 'submitted'
  | 'archived'
  | 'pending'
  | 'cancelled'

export const AGENT_KINDS = ['claude', 'codex'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

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
  error: string | null
}

export interface RecentRepo {
  path: string
  lastUsedAt: number
  useCount: number
  matchedCurrentRepo: boolean
}

export interface Finding extends FindingFromAgent {
  dbId: string
  sessionId: string
  ord: number
  selected: boolean
  edited: boolean
  archived: boolean
  createdAt: number
}

export type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'

export interface Submission {
  id: string
  sessionId: string
  event: ReviewEvent
  githubUrl: string | null
  payloadJson: string
  findingIds: string[]
  submittedAt: number
  error: string | null
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
  daemon: { pid: number; port: number; startedAt: number }
}

export type SSEEvent =
  | { type: 'progress'; sessionId: string; phase: string; detail?: string }
  | { type: 'agent-output'; sessionId: string; chunk: string; ts: number }
  | { type: 'finding-added'; sessionId: string; finding: Finding }
  | { type: 'finding-updated'; sessionId: string; finding: Finding }
  | { type: 'status-changed'; sessionId: string; status: SessionStatus; error?: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'done'; sessionId: string }
  | { type: 'shutting-down' }

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
export interface PromptStateResponse {
  framework: { content: string }
  rules: {
    effective: { source: RulesSource; content: string; path: string | null }
    scopes: Record<PromptScope, { exists: boolean; content: string | null; path: string }>
  }
}
