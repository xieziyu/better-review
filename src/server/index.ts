import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execaSync } from "execa";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { resolvePaths } from "./paths";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { openDatabase } from "./db/connection";
import { SessionsRepo } from "./db/sessions";
import { FindingsRepo } from "./db/findings";
import { SubmissionsRepo } from "./db/submissions";
import { EventBus } from "./engine/events";
import { ConcurrencyQueue } from "./engine/queue";
import { GhClient } from "./github/gh-client";
import { PromptStore } from "./prompts/store";
import { createApp, type AppDeps } from "./api/app";
import { makeStartSession } from "./start-session";
import { submitSession } from "./engine/submit";
import type { ReviewEvent } from "../shared/types";

export interface ServerHandle {
  port: number;
  pid: number;
  shutdown: () => Promise<void>;
}

export interface StartDaemonOpts {
  home?: string;
  cwd?: string;
}

export async function startDaemon(opts: StartDaemonOpts = {}): Promise<ServerHandle> {
  const paths = resolvePaths(opts.home);
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(paths.sessionsDir, { recursive: true });

  const log = createLogger(paths.daemonLog);
  const config = loadConfig(paths.home);
  const db = openDatabase(paths.dbFile);
  const sessions = new SessionsRepo(db);
  const findings = new FindingsRepo(db);
  const submissions = new SubmissionsRepo(db);
  const bus = new EventBus();
  const queue = new ConcurrencyQueue(config.maxConcurrentReviews);
  const gh = new GhClient();
  const cwd = opts.cwd ?? process.cwd();
  const promptStore = new PromptStore({ cwd, home: paths.home });

  const claudePath = which("claude") ?? "claude";

  const startSession = makeStartSession({
    sessions,
    findings,
    gh,
    bus,
    queue,
    config,
    paths: { home: paths.home, sessionsDir: paths.sessionsDir },
    cwd,
    claudePath,
  });

  let port = 0;
  const startedAt = Date.now();
  const deps: AppDeps = {
    sessions,
    findings,
    submissions,
    bus,
    gh,
    promptStore,
    promptCwd: cwd,
    promptHome: paths.home,
    config,
    getPort: () => port,
    startSession,
    rerunSession: async (id) => {
      const s = sessions.getById(id);
      if (!s) throw new Error("not found");
      findings.archiveAllForSession(id);
      const fresh = await startSession(`${s.owner}/${s.repo}#${s.number}`);
      log.info("rerun started", { id, fresh });
    },
    submitSession: (id, event: ReviewEvent, body) => {
      const submitArgs: Parameters<typeof submitSession>[0] = {
        sessionId: id,
        event,
        sessions,
        findings,
        submissions,
        gh,
      };
      if (body !== undefined) submitArgs.body = body;
      return submitSession(submitArgs);
    },
    health: async () => {
      const claudeWhich = which("claude");
      const ghWhich = which("gh");
      const status: import("../shared/types").HealthStatus = {
        ok: true,
        claude: { found: !!claudeWhich },
        gh: {
          found: !!ghWhich,
          authed: await gh.authStatus().catch(() => false),
        },
        daemon: { pid: process.pid, port, startedAt },
      };
      if (claudeWhich) status.claude.path = claudeWhich;
      if (ghWhich) status.gh.path = ghWhich;
      return status;
    },
  };

  const app = createApp(deps);
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.port });
  port = (server.address() as AddressInfo).port;
  writeFileSync(
    paths.serverJson,
    JSON.stringify({ pid: process.pid, port, startedAt }),
  );
  log.info("daemon started", { pid: process.pid, port });

  let lastActivity = Date.now();
  bus.subscribeGlobal(() => {
    lastActivity = Date.now();
  });
  const idleMs = config.idleShutdownMinutes * 60_000;
  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > idleMs) {
      log.info("idle shutdown");
      void shutdown();
    }
  }, Math.min(idleMs, 60_000));
  if (typeof idleTimer.unref === "function") idleTimer.unref();

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(idleTimer);
    bus.emit({ type: "shutting-down" });
    await new Promise<void>((res) => server.close(() => res()));
    try {
      db.close();
    } catch {
      /* already closed */
    }
    if (existsSync(paths.serverJson)) {
      try {
        rmSync(paths.serverJson);
      } catch {
        /* ignore */
      }
    }
    log.info("daemon stopped");
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  return { port, pid: process.pid, shutdown };
}

function which(bin: string): string | null {
  try {
    const r = execaSync("which", [bin], { reject: false });
    return r.exitCode === 0 ? String(r.stdout).trim() : null;
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDaemon()
    .then((h) => process.stdout.write(`daemon listening on ${h.port}\n`))
    .catch((e) => {
      process.stderr.write(`daemon failed: ${(e as Error).message}\n`);
      process.exit(1);
    });
}
