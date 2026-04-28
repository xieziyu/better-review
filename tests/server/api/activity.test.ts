import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { activityMiddleware } from "../../../src/server/api/middleware/activity";
import { createApp } from "../../../src/server/api/app";
import { makeTestDeps } from "./_deps";

describe("activityMiddleware", () => {
  it("invokes onActivity for each request", async () => {
    let count = 0;
    const app = new Hono();
    app.use("*", activityMiddleware(() => count++));
    app.get("/x", (c) => c.json({ ok: true }));
    await app.request("/x");
    await app.request("/x");
    await app.request("/x");
    expect(count).toBe(3);
  });

  it("still bumps on 404 / error responses", async () => {
    let count = 0;
    const app = new Hono();
    app.use("*", activityMiddleware(() => count++));
    app.get("/known", (c) => c.json({ ok: true }));
    await app.request("/missing");
    expect(count).toBe(1);
  });

  it("does not block the response when callback throws", async () => {
    const app = new Hono();
    app.use(
      "*",
      activityMiddleware(() => {
        throw new Error("boom");
      }),
    );
    app.get("/x", (c) => c.json({ ok: true }));
    const res = await app.request("/x");
    expect(res.status).toBe(200);
  });
});

describe("createApp wires onActivity to HTTP traffic", () => {
  it("invokes onActivity for each API request", async () => {
    let count = 0;
    const deps = makeTestDeps();
    deps.onActivity = () => count++;
    const app = createApp(deps);
    await app.request("/api/sessions");
    await app.request("/api/sessions");
    expect(count).toBe(2);
  });

  it("skips activity tracking when onActivity is omitted", async () => {
    const deps = makeTestDeps();
    delete deps.onActivity;
    const app = createApp(deps);
    const res = await app.request("/api/sessions");
    expect(res.status).toBe(200);
  });
});
