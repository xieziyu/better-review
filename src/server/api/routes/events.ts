import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppDeps } from "../app";

export function eventsRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      let id = 0;
      const off = deps.bus.subscribeGlobal((e) => {
        void stream.writeSSE({ id: String(++id), event: e.type, data: JSON.stringify(e) });
      });
      stream.onAbort(() => off());
      while (!stream.aborted && !stream.closed) {
        await stream.sleep(15_000);
      }
    }),
  );
  r.get("/sessions/:id/events", (c) =>
    streamSSE(c, async (stream) => {
      const sid = c.req.param("id");
      let id = 0;
      const off = deps.bus.subscribeSession(sid, (e) => {
        void stream.writeSSE({ id: String(++id), event: e.type, data: JSON.stringify(e) });
      });
      stream.onAbort(() => off());
      while (!stream.aborted && !stream.closed) {
        await stream.sleep(15_000);
      }
    }),
  );
  return r;
}
