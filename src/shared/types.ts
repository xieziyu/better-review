import type { FindingFromClaude, Severity } from "./findings-schema";

export type SessionStatus = "running" | "ready" | "failed" | "submitted" | "archived" | "pending";

export interface PRSession {
  id: string;
  owner: string;
  repo: string;
  number: number;
  title: string | null;
  author: string | null;
  url: string | null;
  baseRef: string | null;
  headRef: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  workdir: string;
  promptUsed: string;
  error: string | null;
}

export interface Finding extends FindingFromClaude {
  dbId: string;
  sessionId: string;
  ord: number;
  selected: boolean;
  edited: boolean;
  archived: boolean;
  createdAt: number;
}

export type ReviewEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

export interface Submission {
  id: string;
  sessionId: string;
  event: ReviewEvent;
  githubUrl: string | null;
  payloadJson: string;
  findingIds: string[];
  submittedAt: number;
  error: string | null;
}

export interface HealthStatus {
  ok: boolean;
  claude: { found: boolean; path?: string };
  gh: { found: boolean; path?: string; authed: boolean };
  daemon: { pid: number; port: number; startedAt: number };
}

export type SSEEvent =
  | { type: "progress"; sessionId: string; phase: string; detail?: string }
  | { type: "finding-added"; sessionId: string; finding: Finding }
  | { type: "finding-updated"; sessionId: string; finding: Finding }
  | { type: "status-changed"; sessionId: string; status: SessionStatus; error?: string }
  | { type: "error"; sessionId: string; message: string }
  | { type: "done"; sessionId: string }
  | { type: "shutting-down" };

export interface CreateSessionRequest {
  prInput: string;
}
export interface SubmitRequest {
  event: ReviewEvent;
  body?: string;
}
export interface UpdateFindingRequest {
  severity?: Severity;
  title?: string;
  body?: string;
  suggestion?: string | null;
  file?: string | null;
  line?: number | null;
}
export interface SelectFindingRequest {
  selected: boolean;
}
export type PromptScope = "global" | "project" | "cwd";
export interface PromptStateResponse {
  effective: { source: PromptScope | "builtin"; content: string };
  scopes: Record<PromptScope, { exists: boolean; content: string | null; path: string }>;
}
