import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppDeps } from "../app";

export function sessionsRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.get("/sessions", (c) => c.json(deps.sessions.list()));
  r.post("/sessions", async (c) => {
    const body = await c.req.json<{ prInput: string }>();
    if (!body?.prInput) return c.json({ error: "prInput required" }, 400);
    try {
      const { id } = await deps.startSession(body.prInput);
      return c.json({ id }, 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  r.get("/sessions/:id", (c) => {
    const id = c.req.param("id");
    const s = deps.sessions.getById(id);
    if (!s) return c.json({ error: "not found" }, 404);
    return c.json({ session: s, findings: deps.findings.listBySession(id) });
  });
  r.get("/sessions/:id/diff", (c) => {
    const id = c.req.param("id");
    const s = deps.sessions.getById(id);
    if (!s) return c.json({ error: "not found" }, 404);
    const cache = join(s.workdir, "diff.cache");
    const diff = existsSync(cache) ? readFileSync(cache, "utf8") : null;
    return c.json({ diff });
  });
  r.delete("/sessions/:id", (c) => {
    deps.sessions.delete(c.req.param("id"));
    return c.body(null, 204);
  });
  r.post("/sessions/:id/rerun", async (c) => {
    try {
      await deps.rerunSession(c.req.param("id"));
      return c.body(null, 202);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  return r;
}
