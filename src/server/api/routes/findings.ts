import { Hono } from "hono";
import type { AppDeps } from "../app";
import type { UpdateFindingPatch } from "../../db/findings";

export function findingsRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.patch("/findings/:id", async (c) => {
    const id = c.req.param("id");
    const cur = deps.findings.getById(id);
    if (!cur) return c.json({ error: "not found" }, 404);
    const patch = (await c.req.json()) as UpdateFindingPatch;
    deps.findings.update(id, patch);
    const next = deps.findings.getById(id)!;
    deps.bus.emit({ type: "finding-updated", sessionId: next.sessionId, finding: next });
    return c.json(next);
  });
  r.patch("/findings/:id/select", async (c) => {
    const id = c.req.param("id");
    const cur = deps.findings.getById(id);
    if (!cur) return c.json({ error: "not found" }, 404);
    const { selected } = await c.req.json<{ selected: boolean }>();
    deps.findings.setSelected(id, !!selected);
    const next = deps.findings.getById(id)!;
    deps.bus.emit({ type: "finding-updated", sessionId: next.sessionId, finding: next });
    return c.json(next);
  });
  r.delete("/findings/:id", (c) => {
    deps.findings.delete(c.req.param("id"));
    return c.body(null, 204);
  });
  return r;
}
