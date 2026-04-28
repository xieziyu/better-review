import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { originGuard } from "../../../src/server/api/middleware/origin";

describe("originGuard", () => {
  const app = new Hono();
  app.use("*", originGuard(() => 5555));
  app.get("/x", (c) => c.json({ ok: true }));

  it("allows missing Origin (curl)", async () => {
    const res = await app.request("/x");
    expect(res.status).toBe(200);
  });
  it("allows 127.0.0.1 origin", async () => {
    const res = await app.request("/x", { headers: { Origin: "http://127.0.0.1:5555" } });
    expect(res.status).toBe(200);
  });
  it("blocks foreign origin", async () => {
    const res = await app.request("/x", { headers: { Origin: "https://evil.com" } });
    expect(res.status).toBe(403);
  });
});
