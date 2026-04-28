import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDaemon, readServerJson } from "../../src/cli/daemon-launcher";
import { startDaemon, type ServerHandle } from "../../src/server/index";

describe("daemon-launcher", () => {
  let home: string;
  let active: ServerHandle[] = [];
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "br-cli-"));
    active = [];
  });
  afterEach(async () => {
    for (const h of active) await h.shutdown();
  });

  it("returns existing daemon info if alive", async () => {
    const h = await startDaemon({ home, cwd: home });
    active.push(h);
    const info = await ensureDaemon({
      home,
      spawnFn: async () => {
        throw new Error("should not spawn");
      },
    });
    expect(info.port).toBe(h.port);
  });

  it("spawns when no server.json", async () => {
    let called = false;
    const info = await ensureDaemon({
      home,
      spawnFn: async () => {
        called = true;
        const h = await startDaemon({ home, cwd: home });
        active.push(h);
        return { pid: h.pid, port: h.port, startedAt: Date.now() };
      },
    });
    expect(called).toBe(true);
    expect(info.port).toBeGreaterThan(0);
    expect(readServerJson(home)?.port).toBe(info.port);
  });

  it("returns null from readServerJson when missing", () => {
    expect(readServerJson(home)).toBeNull();
  });
});
