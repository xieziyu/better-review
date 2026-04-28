import type {
  PRSession,
  Finding,
  HealthStatus,
  CreateSessionRequest,
  SubmitRequest,
  UpdateFindingRequest,
  SelectFindingRequest,
  PromptStateResponse,
  PromptScope,
} from "@shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    msg: string,
  ) {
    super(msg);
    this.name = "ApiError";
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      msg = body.error ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type WritablePromptScope = Exclude<PromptScope, "cwd">;

export const api = {
  health: (): Promise<HealthStatus> => req<HealthStatus>("/api/health"),
  listSessions: (): Promise<PRSession[]> => req<PRSession[]>("/api/sessions"),
  getSession: (id: string): Promise<{ session: PRSession; findings: Finding[] }> =>
    req(`/api/sessions/${id}`),
  createSession: (b: CreateSessionRequest): Promise<{ id: string }> =>
    req("/api/sessions", { method: "POST", body: JSON.stringify(b) }),
  deleteSession: (id: string): Promise<void> =>
    req(`/api/sessions/${id}`, { method: "DELETE" }),
  rerunSession: (id: string): Promise<void> =>
    req(`/api/sessions/${id}/rerun`, { method: "POST" }),
  updateFinding: (id: string, b: UpdateFindingRequest): Promise<Finding> =>
    req(`/api/findings/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  selectFinding: (id: string, b: SelectFindingRequest): Promise<Finding> =>
    req(`/api/findings/${id}/select`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteFinding: (id: string): Promise<void> =>
    req(`/api/findings/${id}`, { method: "DELETE" }),
  submit: (
    id: string,
    b: SubmitRequest,
  ): Promise<{ url: string; droppedToBody: string[] }> =>
    req(`/api/sessions/${id}/submit`, { method: "POST", body: JSON.stringify(b) }),
  getPrompts: (): Promise<PromptStateResponse> => req("/api/prompts"),
  putPrompt: (scope: WritablePromptScope, content: string): Promise<{ ok: true }> =>
    req(`/api/prompts/${scope}`, { method: "PUT", body: JSON.stringify({ content }) }),
  deletePrompt: (scope: WritablePromptScope): Promise<void> =>
    req(`/api/prompts/${scope}`, { method: "DELETE" }),
};

export const queryKeys = {
  health: ["health"] as const,
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  prompts: ["prompts"] as const,
};
