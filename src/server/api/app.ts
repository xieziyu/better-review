import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { originGuard } from "./middleware/origin";
import { healthRoutes } from "./routes/health";
import { sessionsRoutes } from "./routes/sessions";
import { findingsRoutes } from "./routes/findings";
import { promptsRoutes } from "./routes/prompts";
import { eventsRoutes } from "./routes/events";
import { submitRoutes } from "./routes/submit";
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
  webDir?: string;
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
  app.route("/api", healthRoutes(deps));
  app.route("/api", sessionsRoutes(deps));
  app.route("/api", findingsRoutes(deps));
  app.route("/api", promptsRoutes(deps));
  app.route("/api", eventsRoutes(deps));
  app.route("/api", submitRoutes(deps));

  if (deps.webDir && existsSync(join(deps.webDir, "index.html"))) {
    const webDir = deps.webDir;
    const indexHtml = readFileSync(join(webDir, "index.html"), "utf8");
    const root = relative(process.cwd(), webDir) || ".";
    app.use("/*", serveStatic({ root }));
    app.notFound((c) => {
      const accept = c.req.header("accept") ?? "";
      if (accept.includes("text/html")) return c.html(indexHtml);
      return c.json({ error: "not found" }, 404);
    });
  }
  return app;
}
