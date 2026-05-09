import type {
  PRSession,
  Finding,
  HealthStatus,
  CreateSessionRequest,
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
  updateFinding: (id: string, b: UpdateFindingRequest): Promise<Finding> =>
    req(`/api/findings/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  selectFinding: (id: string, b: SelectFindingRequest): Promise<Finding> =>
    req(`/api/findings/${id}/select`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteFinding: (id: string): Promise<void> => req(`/api/findings/${id}`, { method: 'DELETE' }),
  submit: (id: string, b: SubmitRequest): Promise<{ url: string; droppedToBody: string[] }> =>
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
  getPrompts: (): Promise<PromptStateResponse> => req('/api/prompts'),
  putPrompt: (scope: WritablePromptScope, content: string): Promise<{ ok: true }> =>
    req(`/api/prompts/${scope}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  deletePrompt: (scope: WritablePromptScope): Promise<void> =>
    req(`/api/prompts/${scope}`, { method: 'DELETE' }),
}

export const queryKeys = {
  health: ['health'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['session', id] as const,
  prompts: ['prompts'] as const,
  recentRepos: (owner: string, repo: string) => ['recent-repos', owner, repo] as const,
}
