import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, defaultConfig } from "../../src/server/config";

describe("loadConfig", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "br-cfg-"));
  });
  it("returns defaults when file missing", () => {
    expect(loadConfig(home)).toEqual(defaultConfig);
  });
  it("merges user overrides", () => {
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ port: 8765, maxConcurrentReviews: 2 }),
    );
    const c = loadConfig(home);
    expect(c.port).toBe(8765);
    expect(c.maxConcurrentReviews).toBe(2);
    expect(c.idleShutdownMinutes).toBe(defaultConfig.idleShutdownMinutes);
  });
  it("rejects unknown keys silently (strips)", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ foo: 1, port: 1234 }));
    const c = loadConfig(home);
    expect((c as Record<string, unknown>).foo).toBeUndefined();
    expect(c.port).toBe(1234);
  });
});
