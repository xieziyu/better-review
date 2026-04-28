import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../src/server/api/app";
import { makeTestDeps } from "./_deps";
import type { PRSession, Finding } from "../../../src/shared/types";

describe("sessions API", () => {
  it("POST /api/sessions creates and returns id", async () => {
    const deps = makeTestDeps();
    const app = createApp(deps);
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prInput: "owner/repo#1" }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { id: string }).id).toBe("new1");
  });

  it("GET /api/sessions lists", async () => {
    const deps = makeTestDeps();
    deps.sessions.insert({
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
      workdir: "/w",
      promptUsed: "p",
    });
    const app = createApp(deps);
    const res = await app.request("/api/sessions");
    expect(res.status).toBe(200);
    const list = (await res.json()) as PRSession[];
    expect(list).toHaveLength(1);
  });

  it("GET /api/sessions/:id returns session + findings", async () => {
    const deps = makeTestDeps();
    deps.sessions.insert({
      id: "s1",
      owner: "o",
      repo: "r",
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: "ready",
      workdir: "/w",
      promptUsed: "p",
    });
    deps.findings.insertMany("s1", [
      { id: "R1", severity: "must", category: "x", file: null, line: null, title: "t", body: "b" },
    ]);
    const app = createApp(deps);
    const res = await app.request("/api/sessions/s1");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { session: PRSession; findings: Finding[] };
    expect(j.session.id).toBe("s1");
    expect(j.findings).toHaveLength(1);
  });

  it("DELETE /api/sessions/:id removes from DB", async () => {
    const deps = makeTestDeps();
    deps.sessions.insert({
      id: "s1",
      owner: "o",
      repo: "r",
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: "ready",
      workdir: "/w",
      promptUsed: "p",
    });
    const app = createApp(deps);
    expect((await app.request("/api/sessions/s1", { method: "DELETE" })).status).toBe(204);
    expect(deps.sessions.getById("s1")).toBeNull();
  });

  it("GET /api/sessions/:id/diff returns cached diff", async () => {
    const deps = makeTestDeps();
    const wd = mkdtempSync(join(tmpdir(), "br-diff-"));
    const diff = "diff --git a/x b/x\n@@ -0,0 +1 @@\n+hi\n";
    writeFileSync(join(wd, "diff.cache"), diff);
    deps.sessions.insert({
      id: "s1",
      owner: "o",
      repo: "r",
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: "ready",
      workdir: wd,
      promptUsed: "p",
    });
    const app = createApp(deps);
    const res = await app.request("/api/sessions/s1/diff");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { diff: string | null };
    expect(j.diff).toBe(diff);
  });

  it("GET /api/sessions/:id/diff returns null when diff.cache missing", async () => {
    const deps = makeTestDeps();
    const wd = mkdtempSync(join(tmpdir(), "br-diff-empty-"));
    deps.sessions.insert({
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
      workdir: wd,
      promptUsed: "p",
    });
    const app = createApp(deps);
    const res = await app.request("/api/sessions/s1/diff");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { diff: string | null };
    expect(j.diff).toBeNull();
  });

  it("GET /api/sessions/:id/diff returns 404 when session unknown", async () => {
    const deps = makeTestDeps();
    const app = createApp(deps);
    const res = await app.request("/api/sessions/missing/diff");
    expect(res.status).toBe(404);
  });

  it("POST /api/sessions/:id/rerun calls rerunSession", async () => {
    let called = false;
    const deps = makeTestDeps({
      rerunSession: async () => {
        called = true;
      },
    });
    deps.sessions.insert({
      id: "s1",
      owner: "o",
      repo: "r",
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: "ready",
      workdir: "/w",
      promptUsed: "p",
    });
    const app = createApp(deps);
    const res = await app.request("/api/sessions/s1/rerun", { method: "POST" });
    expect(res.status).toBe(202);
    expect(called).toBe(true);
  });
});
