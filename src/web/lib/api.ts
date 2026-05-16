import type { ManualFindingInput } from '@shared/findings-schema'
import type {
  AppConfig,
  PRSession,
  Finding,
  HealthStatus,
  CreateSessionRequest,
  PrepCall,
  PrepStep,
  RecentRepo,
  SubmitRequest,
  UpdateFindingRequest,
  SelectFindingRequest,
  PromptStateResponse,
  PromptScope,
  AgentKind,
} from '@shared/types'

export type WritablePromptScope = PromptScope

export class ApiError extends Error {
  constructor(
    public status: number,
    msg: string,
  ) {
    super(msg)
    this.name = 'ApiError'
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = res.statusText
    if (text) {
      try {
        const body = JSON.parse(text) as { error?: string }
        msg = body.error ?? msg
      } catch {
        /* ignore */
      }
    }
    throw new ApiError(res.status, msg)
  }
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export const api = {
  health: (): Promise<HealthStatus> => req<HealthStatus>('/api/health'),
  listSessions: (): Promise<PRSession[]> => req<PRSession[]>('/api/sessions'),
  getSession: (
    id: string,
  ): Promise<{ session: PRSession; findings: Finding[]; diff?: string | null }> =>
    req(`/api/sessions/${id}`),
  getSessionDiff: async (id: string): Promise<string | null> => {
    const res = await fetch(`/api/sessions/${id}/diff`)
    if (res.status === 404) return null
    if (!res.ok) throw new ApiError(res.status, res.statusText)
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      const j = (await res.json()) as { diff?: string | null }
      return j.diff ?? null
    }
    return await res.text()
  },
  getSessionTranscript: (id: string): Promise<{ chunks: string[]; truncated: boolean }> =>
    req(`/api/sessions/${id}/transcript`),
  getSessionPrepLog: (
    id: string,
  ): Promise<{ phases: PrepStep[]; calls: PrepCall[]; truncated: boolean }> =>
    req(`/api/sessions/${id}/prep-log`),
  createSession: (b: CreateSessionRequest): Promise<{ id: string }> =>
    req('/api/sessions', { method: 'POST', body: JSON.stringify(b) }),
  deleteSession: (id: string): Promise<void> => req(`/api/sessions/${id}`, { method: 'DELETE' }),
  cancelSession: (id: string): Promise<void> =>
    req(`/api/sessions/${id}/cancel`, { method: 'POST' }),
  rerunSession: (
    id: string,
    body?: { agent?: AgentKind; extraPrompt?: string },
  ): Promise<{ id: string }> => {
    const init: RequestInit = { method: 'POST' }
    if (body) init.body = JSON.stringify(body)
    return req(`/api/sessions/${id}/rerun`, init)
  },
  createManualFinding: async (sessionId: string, b: ManualFindingInput): Promise<Finding> => {
    const r = await req<{ finding: Finding }>(`/api/sessions/${sessionId}/findings/manual`, {
      method: 'POST',
      body: JSON.stringify(b),
    })
    return r.finding
  },
  updateFinding: (id: string, b: UpdateFindingRequest): Promise<Finding> =>
    req(`/api/findings/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  selectFinding: (id: string, b: SelectFindingRequest): Promise<Finding> =>
    req(`/api/findings/${id}/select`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteFinding: (id: string): Promise<void> => req(`/api/findings/${id}`, { method: 'DELETE' }),
  submit: (
    id: string,
    b: SubmitRequest,
  ): Promise<{ url: string; droppedToBody: string[]; skippedDuplicates: number }> =>
    req(`/api/sessions/${id}/submit`, { method: 'POST', body: JSON.stringify(b) }),
  pickDirectory: async (prompt?: string): Promise<{ path: string | null; supported: boolean }> => {
    try {
      const r = await req<{ path: string | null }>('/api/fs/pick-directory', {
        method: 'POST',
        body: JSON.stringify(prompt ? { prompt } : {}),
      })
      return { path: r.path, supported: true }
    } catch (e) {
      if (e instanceof ApiError && e.status === 501) return { path: null, supported: false }
      throw e
    }
  },
  recentRepos: (q?: {
    owner?: string
    repo?: string
    limit?: number
  }): Promise<{ items: RecentRepo[] }> => {
    const sp = new URLSearchParams()
    if (q?.owner) sp.set('owner', q.owner)
    if (q?.repo) sp.set('repo', q.repo)
    if (q?.limit) sp.set('limit', String(q.limit))
    const qs = sp.toString()
    return req(qs ? `/api/recent-repos?${qs}` : '/api/recent-repos')
  },
  getPrompts: (repo?: string | null): Promise<PromptStateResponse> =>
    req(repo ? `/api/prompts?repo=${encodeURIComponent(repo)}` : '/api/prompts'),
  putPrompt: (
    scope: WritablePromptScope,
    content: string,
    repo?: string | null,
  ): Promise<{ ok: true }> =>
    req(`/api/prompts/${scope}`, {
      method: 'PUT',
      body: JSON.stringify(repo ? { content, repo } : { content }),
    }),
  deletePrompt: (scope: WritablePromptScope, repo?: string | null): Promise<void> =>
    req(repo ? `/api/prompts/${scope}?repo=${encodeURIComponent(repo)}` : `/api/prompts/${scope}`, {
      method: 'DELETE',
    }),
  getConfig: (): Promise<{ config: AppConfig; file: string }> => req('/api/config'),
  putConfig: (b: AppConfig): Promise<{ config: AppConfig }> =>
    req('/api/config', { method: 'PUT', body: JSON.stringify(b) }),
}

export const queryKeys = {
  health: ['health'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['session', id] as const,
  sessionTranscript: (id: string) => ['session-transcript', id] as const,
  sessionPrepLog: (id: string) => ['session-prep-log', id] as const,
  // Base key for invalidating every per-repo prompt query at once.
  promptsBase: ['prompts'] as const,
  prompts: (repo: string | null) => ['prompts', repo] as const,
  config: ['config'] as const,
  recentRepos: (owner: string, repo: string) => ['recent-repos', owner, repo] as const,
}
