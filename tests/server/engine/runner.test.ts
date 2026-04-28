import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { FindingsRepo } from "../../../src/server/db/findings";
import { EventBus } from "../../../src/server/engine/events";
import { runReview } from "../../../src/server/engine/runner";
import type { SSEEvent } from "../../../src/shared/types";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = resolve(here, "../../fixtures/fake-claude.sh");

describe("runReview (happy path)", () => {
  let workdir: string;
  let sessions: SessionsRepo;
  let findings: FindingsRepo;
  let bus: EventBus;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "br-run-"));
    const db = openDatabase(join(dir, "s.db"));
    sessions = new SessionsRepo(db);
    findings = new FindingsRepo(db);
    bus = new EventBus();
    workdir = mkdtempSync(join(tmpdir(), "br-run-wd-"));
    sessions.insert({
      id: "s1",
      owner: "o",
      repo: "r",
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: "running",
      workdir,
      promptUsed: "p",
    });
  });

  it("spawns claude, parses findings.json, transitions to ready", async () => {
    const events: SSEEvent[] = [];
    bus.subscribeGlobal((e) => events.push(e));
    const promptText = `do review. FINDINGS_PATH=${join(workdir, "findings.json")}`;
    writeFileSync(join(workdir, "prompt.txt"), promptText);
    await runReview({
      sessionId: "s1",
      workdir,
      prompt: promptText,
      claudePath: FAKE_CLAUDE,
      sessions,
      findings,
      bus,
      stallMs: 60_000,
    });
    const got = sessions.getById("s1")!;
    expect(got.status).toBe("ready");
    expect(findings.listBySession("s1")).toHaveLength(1);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(events.some((e) => e.type === "finding-added")).toBe(true);
  });
});

describe("runReview (failure paths)", () => {
  let workdir: string;
  let sessions: SessionsRepo;
  let findings: FindingsRepo;
  let bus: EventBus;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "br-run-"));
    const db = openDatabase(join(dir, "s.db"));
    sessions = new SessionsRepo(db);
    findings = new FindingsRepo(db);
    bus = new EventBus();
    workdir = mkdtempSync(join(tmpdir(), "br-run-wd-"));
    sessions.insert({
      id: "s2",
      owner: "o",
      repo: "r",
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: "running",
      workdir,
      promptUsed: "p",
    });
  });

  it("transitions to failed on non-zero exit", async () => {
    process.env.FAKE_CLAUDE_FAIL = "1";
    try {
      const promptText = `FINDINGS_PATH=${join(workdir, "findings.json")}`;
      await runReview({
        sessionId: "s2",
        workdir,
        prompt: promptText,
        claudePath: FAKE_CLAUDE,
        sessions,
        findings,
        bus,
        stallMs: 60_000,
      });
      expect(sessions.getById("s2")!.status).toBe("failed");
    } finally {
      delete process.env.FAKE_CLAUDE_FAIL;
    }
  });

  it(
    "kills stalled claude and marks failed",
    async () => {
      process.env.FAKE_CLAUDE_STALL = "1";
      try {
        const promptText = `FINDINGS_PATH=${join(workdir, "findings.json")}`;
        await runReview({
          sessionId: "s2",
          workdir,
          prompt: promptText,
          claudePath: FAKE_CLAUDE,
          sessions,
          findings,
          bus,
          stallMs: 200,
        });
        expect(sessions.getById("s2")!.status).toBe("failed");
      } finally {
        delete process.env.FAKE_CLAUDE_STALL;
      }
    },
    15_000,
  );
});
