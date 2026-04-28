import { test, expect } from "@playwright/test";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

let daemon: ChildProcess;
let port = 0;

async function waitForServerJson(home: string, timeoutMs = 15_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const f = join(home, "server.json");
    if (existsSync(f)) {
      try {
        const j = JSON.parse(readFileSync(f, "utf8"));
        if (j.port) return j.port;
      } catch {
        /* writing in progress */
      }
    }
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("daemon never wrote server.json");
}

test.beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), "br-e2e-"));
  const fakeBinDir = mkdtempSync(join(tmpdir(), "br-bin-"));
  const fakeGh = resolve("tests/fixtures/fake-gh.sh");
  const fakeClaude = resolve("tests/fixtures/fake-claude.sh");
  copyFileSync(fakeGh, join(fakeBinDir, "gh"));
  copyFileSync(fakeClaude, join(fakeBinDir, "claude"));
  chmodSync(join(fakeBinDir, "gh"), 0o755);
  chmodSync(join(fakeBinDir, "claude"), 0o755);

  const env = {
    ...process.env,
    BETTER_REVIEW_HOME: home,
    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
  };
  daemon = spawn(process.execPath, ["dist/server/index.js"], {
    env,
    stdio: "pipe",
  });
  daemon.stdout?.on("data", (d) => process.stdout.write(`[daemon] ${d}`));
  daemon.stderr?.on("data", (d) => process.stderr.write(`[daemon err] ${d}`));
  port = await waitForServerJson(home);
});

test.afterAll(async () => {
  if (daemon && !daemon.killed) {
    daemon.kill("SIGTERM");
    await new Promise((res) => setTimeout(res, 200));
    if (!daemon.killed) daemon.kill("SIGKILL");
  }
});

test("homepage loads and displays new PR input", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator("input[aria-label='PR target']")).toBeVisible();
  await expect(page.getByRole("button", { name: /Start review/i })).toBeVisible();
});

test("create session via API and find it on homepage", async ({ page }) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prInput: "owner/repo#1" }),
  });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  expect(id).toBeTruthy();

  await page.goto(`http://127.0.0.1:${port}/pr/${id}`);
  await expect(page.locator("body")).toContainText("owner/repo#1", { timeout: 30_000 });
});
