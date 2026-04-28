import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ServerInfo {
  pid: number;
  port: number;
  startedAt: number;
}

export function readServerJson(home: string): ServerInfo | null {
  const p = join(home, "server.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ServerInfo;
  } catch {
    return null;
  }
}

export async function probeHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export interface EnsureOpts {
  home: string;
  spawnFn: () => Promise<ServerInfo>;
  pollMs?: number;
  timeoutMs?: number;
}

export async function ensureDaemon(opts: EnsureOpts): Promise<ServerInfo> {
  const existing = readServerJson(opts.home);
  if (existing && (await probeHealth(existing.port))) return existing;
  const fresh = await opts.spawnFn();
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  while (Date.now() < deadline) {
    if (await probeHealth(fresh.port)) return fresh;
    await new Promise((res) => setTimeout(res, opts.pollMs ?? 100));
  }
  throw new Error("daemon failed to become healthy in time");
}
