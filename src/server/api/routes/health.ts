import { Hono } from "hono";
import type { AppDeps } from "../app";

export function healthRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.get("/health", async (c) => c.json(await deps.health()));
  return r;
}
