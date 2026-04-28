import { Hono } from "hono";
import { originGuard } from "./middleware/origin";
import type { SessionsRepo } from "../db/sessions";
import type { FindingsRepo } from "../db/findings";
import type { SubmissionsRepo } from "../db/submissions";
import type { EventBus } from "../engine/events";
import type { GhClient } from "../github/gh-client";
import type { PromptStore } from "../prompts/store";
import type { Config } from "../config";
import type { HealthStatus, ReviewEvent } from "../../shared/types";

export interface AppDeps {
  sessions: SessionsRepo;
  findings: FindingsRepo;
  submissions: SubmissionsRepo;
  bus: EventBus;
  gh: GhClient;
  promptStore: PromptStore;
  promptCwd: string;
  promptHome: string;
  config: Config;
  getPort: () => number;
  startSession: (input: string) => Promise<{ id: string }>;
  rerunSession: (id: string) => Promise<void>;
  submitSession: (
    id: string,
    event: ReviewEvent,
    body?: string,
  ) => Promise<{ url: string; droppedToBody: string[] }>;
  health: () => Promise<HealthStatus>;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("*", originGuard(deps.getPort));
  return app;
}
