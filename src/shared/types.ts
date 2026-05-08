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
  promptUsed: string
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
