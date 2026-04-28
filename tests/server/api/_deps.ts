import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { FindingsRepo } from "../../../src/server/db/findings";
import { SubmissionsRepo } from "../../../src/server/db/submissions";
import { EventBus } from "../../../src/server/engine/events";
import { PromptStore } from "../../../src/server/prompts/store";
import type { AppDeps } from "../../../src/server/api/app";
import type { GhClient } from "../../../src/server/github/gh-client";

export interface DepsOverrides {
  startSession?: AppDeps["startSession"];
  rerunSession?: AppDeps["rerunSession"];
  submitSession?: AppDeps["submitSession"];
  health?: AppDeps["health"];
}

export function makeTestDeps(overrides: DepsOverrides = {}): AppDeps {
  const cwd = mkdtempSync(join(tmpdir(), "br-pcwd-"));
  const home = mkdtempSync(join(tmpdir(), "br-phome-"));
  const dbDir = mkdtempSync(join(tmpdir(), "br-api-"));
  const db = openDatabase(join(dbDir, "s.db"));
  return {
    sessions: new SessionsRepo(db),
    findings: new FindingsRepo(db),
    submissions: new SubmissionsRepo(db),
    bus: new EventBus(),
    gh: {} as GhClient,
    promptStore: new PromptStore({ cwd, home }),
    promptCwd: cwd,
    promptHome: home,
    config: {
      port: 5555,
      idleShutdownMinutes: 1,
      maxConcurrentReviews: 1,
      claudeStallMinutes: 1,
      perPRGCDays: 1,
    },
    getPort: () => 5555,
    startSession: overrides.startSession ?? (async () => ({ id: "new1" })),
    rerunSession: overrides.rerunSession ?? (async () => {}),
    submitSession: overrides.submitSession ?? (async () => ({ url: "https://gh", droppedToBody: [] })),
    health:
      overrides.health ??
      (async () => ({
        ok: true,
        claude: { found: true, path: "/usr/bin/claude" },
        gh: { found: true, path: "/usr/bin/gh", authed: true },
        daemon: { pid: 1, port: 5555, startedAt: 1 },
      })),
  };
}
