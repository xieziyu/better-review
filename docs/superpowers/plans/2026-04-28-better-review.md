# better-review v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Node.js tool that runs PR reviews via `claude` CLI + `gh` CLI and provides a browser UI for selecting/editing/submitting findings.

**Architecture:** Single Node daemon (Hono + better-sqlite3) spawns `claude` subprocess per review session, watches `findings.json` writes via chokidar, exposes REST + SSE to a React/Vite SPA. CLI is a thin wrapper that starts the daemon and opens the browser.

**Tech Stack:** Node.js LTS · TypeScript · Hono · better-sqlite3 · React + Vite · Tailwind + shadcn/ui · TanStack Query · vitest · Playwright

---

## Team assignment legend

- `[BE]` backend-dev — phases 0–16, 23, 24
- `[FE]` frontend-dev — phases 17–22

Tasks involving shared types are owned by `[BE]` since the backend defines the source of truth. Designer iterates on UI tasks separately; do not bake design decisions into UI code beyond shadcn defaults.

---

## File structure

Each file's responsibility (one paragraph each):

**Root config:**
- `package.json` — single package, declares `bin: { "better-review": "dist/cli/index.js" }`, scripts for `build`, `dev:server`, `dev:web`, `test`, `e2e`.
- `tsconfig.json` — base TS config (strict, ES2022, node module resolution); `tsconfig.server.json`, `tsconfig.web.json`, `tsconfig.test.json` extend it for each surface.
- `vitest.config.ts` — wires `src/server/**` and `src/shared/**` tests; node env, single fork.
- `vite.config.ts` — for `src/web`, builds to `dist/web`, dev proxy `/api → 127.0.0.1:5173-or-env`.
- `tailwind.config.ts`, `postcss.config.cjs`, `components.json` — shadcn/ui setup pinned to `src/web`.
- `.eslintrc.cjs`, `.prettierrc` — shared lint/format.
- `.gitignore` — already has node_modules, dist, .superpowers; adds `~/.better-review/` is N/A (lives in $HOME).

**Shared (`src/shared/`):**
- `types.ts` — `Finding`, `PRSession`, `Submission`, `HealthStatus`, `SSEEvent` discriminated union, API request/response shapes. Imported by both server and web.
- `findings-schema.ts` — runtime JSON schema (zod) for the `findings.json` claude writes; exports both schema and TS type via `z.infer`.

**CLI (`src/cli/`):**
- `index.ts` — commander entry; subcommands: default (start+open), `<PR>` arg, `--stop`, `--status`. Reads `~/.better-review/server.json`, spawns detached daemon if missing, polls `/api/health`, then `open()` browser.
- `daemon-launcher.ts` — pure function: given config dir, returns `{ pid, port }` of running daemon (spawning if needed). Used by `index.ts` and tests.
- `paths.ts` — re-exports server's path helpers for `~/.better-review/`.

**Server core (`src/server/`):**
- `index.ts` — daemon entry point; initializes config, DB, gh client, prompt resolver, engine, HTTP app. Writes `server.json`. Installs SIGTERM/SIGINT graceful shutdown.
- `paths.ts` — single source for `~/.better-review/`, server.json path, sessions dir, prompts dir, db file, log file. Honors `BETTER_REVIEW_HOME` env override (for tests).
- `config.ts` — loads `~/.better-review/config.json` with defaults; exports `Config` type.
- `logger.ts` — minimal pino-style logger writing to `~/.better-review/daemon.log` and stderr.

**Server DB (`src/server/db/`):**
- `connection.ts` — opens better-sqlite3 in WAL mode, returns singleton `Database` instance; exposes `closeDb()`.
- `migrations.ts` — runs SQL files in `migrations/` in order, tracks applied versions in `_schema_version` table.
- `migrations/0001_init.sql` — initial schema (pr_sessions, findings, submissions, indexes per spec §6.5).
- `sessions.ts` — repository: `insert`, `update`, `getById`, `list`, `findActiveByPR`, `setStatus`, `setError`.
- `findings.ts` — repository: `insertMany`, `update`, `setSelected`, `setArchived`, `listBySession`, `getById`, `delete`.
- `submissions.ts` — repository: `insert`, `listBySession`.

**Server github (`src/server/github/`):**
- `gh-client.ts` — wraps `gh` CLI: `prView`, `prDiff`, `submitReview`, `authStatus`. Uses `execa`. All errors classified to typed error classes.
- `pr-target-parser.ts` — accepts `123`, `owner/repo#123`, full GitHub URL; returns `{ owner, repo, number }` or throws.
- `errors.ts` — `GhCliMissingError`, `GhAuthError`, `GhPRNotFoundError`, `GhSubmitError`.

**Server prompts (`src/server/prompts/`):**
- `resolver.ts` — three-level resolution (cwd → home → builtin); returns `{ source, content }`.
- `renderer.ts` — replaces `{{PR_META}}`, `{{DIFF}}`, `{{FINDINGS_PATH}}`, `{{SCHEMA}}` placeholders.
- `store.ts` — read/write/delete prompt files at the three scopes.
- `builtin.ts` — exports the bundled default prompt as a string (read from `prompts/builtin.md` at startup; embedded for `npm` install).

**Server engine (`src/server/engine/`):**
- `events.ts` — typed SSE bus: in-memory `EventEmitter` keyed by sessionId, plus a global stream for sidebar.
- `stream-json.ts` — line-delimited JSON parser for `claude --output-format stream-json` stdout. Emits typed events.
- `findings-watcher.ts` — chokidar watcher for one path, debounces, parses JSON via `findings-schema`, returns parsed array or error.
- `findings-parser.ts` — pure: takes raw JSON text, validates against zod schema, returns `Finding[]` or descriptive error.
- `runner.ts` — runs one review session: spawns `claude`, wires watchers, watchdog, handles exit, transitions status. Pure-ish: takes a `SessionContext` deps object.
- `queue.ts` — concurrency queue with `maxConcurrentReviews`; pending sessions wait, FIFO.
- `submit.ts` — builds GitHub review payload from selected findings, splits comments[] vs body, validates lines, writes payload temp file, calls `gh.submitReview`.
- `payload-builder.ts` — pure helper: given findings + diff, returns `{ payload, droppedToBody: Finding[] }`.
- `diff-line-validator.ts` — pure helper: given unified diff + (file, line), returns boolean.

**Server API (`src/server/api/`):**
- `app.ts` — Hono app factory; mounts routes, applies origin check + JSON middleware.
- `middleware/origin.ts` — rejects requests where `Origin` is set and not `http://127.0.0.1:<port>` or `http://localhost:<port>`.
- `routes/sessions.ts` — list/create/get/delete/rerun.
- `routes/findings.ts` — patch / delete / select.
- `routes/submit.ts` — POST submit; calls engine submit.
- `routes/prompts.ts` — get effective + per-scope put/delete.
- `routes/health.ts` — claude/gh checks + auth status.
- `routes/events.ts` — global + per-session SSE.

**Web (`src/web/`):**
- `index.html`, `main.tsx` — Vite entry; mounts `<App />` with React Router.
- `App.tsx` — top-level layout (`<HealthBanner /> + <Sidebar /> + <Outlet />`).
- `lib/api.ts` — typed REST client (fetch wrapper with JSON errors).
- `lib/sse.ts` — `useSSE(url)` hook that connects EventSource and yields parsed typed events.
- `lib/queryClient.ts` — TanStack Query client config + key helpers.
- `pages/Home.tsx` — welcome + new-PR input + recent sessions grid.
- `pages/PRDetail.tsx` — wraps `<FindingList />`, `<DiffViewer />`, `<SubmitDrawer />`; subscribes per-session SSE.
- `pages/PromptEditor.tsx` — three-tab scope editor.
- `pages/Settings.tsx` — config form (idleShutdownMinutes, default event, claudeStallMinutes).
- `components/Sidebar.tsx` — list of sessions with status badge; filters; uses global SSE.
- `components/HealthBanner.tsx` — top red bar when claude/gh missing.
- `components/FindingList.tsx` — grouped by file, severity-sorted; bulk select all.
- `components/FindingCard.tsx` — checkbox + severity dropdown + markdown editor (split preview) + delete + GitHub link.
- `components/DiffViewer.tsx` — `react-diff-view` slice ±10 lines, expand-to-full-hunk.
- `components/SubmitDrawer.tsx` — review preview + event picker + submit.
- `components/ui/*` — shadcn-generated primitives.

**Tests:**
- `tests/server/**` — vitest server unit/integration, structure mirrors `src/server`.
- `tests/shared/**` — schema tests.
- `tests/e2e/**` — Playwright with fake claude/gh shell shims.
- `tests/fixtures/` — sample PR diffs, sample findings.json, fake-claude.sh, fake-gh.sh.

---

## Phase 0: Bootstrap [BE]

### Task 0.1: [BE] Initialize package and TypeScript

**Files:**
- Create: `/Users/ziyu/Projects/better-review/package.json`
- Create: `/Users/ziyu/Projects/better-review/tsconfig.json`
- Create: `/Users/ziyu/Projects/better-review/tsconfig.server.json`
- Create: `/Users/ziyu/Projects/better-review/tsconfig.web.json`
- Create: `/Users/ziyu/Projects/better-review/tsconfig.test.json`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "better-review",
  "version": "0.1.0",
  "description": "Local PR review helper combining claude CLI + gh CLI with a browser UI.",
  "type": "module",
  "bin": { "better-review": "dist/cli/index.js" },
  "files": ["dist", "prompts/builtin.md", "README.md"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "npm run build:server && npm run build:web",
    "build:server": "tsc -p tsconfig.server.json",
    "build:web": "vite build",
    "dev:server": "tsx watch src/server/index.ts",
    "dev:web": "vite",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "lint": "eslint .",
    "format": "prettier -w ."
  },
  "dependencies": {
    "better-sqlite3": "^11.5.0",
    "chokidar": "^4.0.1",
    "commander": "^12.1.0",
    "execa": "^9.5.1",
    "hono": "^4.6.10",
    "@hono/node-server": "^1.13.5",
    "open": "^10.1.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.2",
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.9.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@typescript-eslint/eslint-plugin": "^8.13.0",
    "@typescript-eslint/parser": "^8.13.0",
    "@vitejs/plugin-react": "^4.3.3",
    "eslint": "^9.14.0",
    "prettier": "^3.3.3",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json` (base)**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false
  }
}
```

- [ ] **Step 3: Write `tsconfig.server.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/cli/**/*", "src/server/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 4: Write `tsconfig.web.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src/web/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 5: Write `tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "types": ["node", "vitest/globals"] },
  "include": ["tests/**/*", "src/**/*"]
}
```

- [ ] **Step 6: Run install + typecheck**

Run: `npm install && npx tsc -p tsconfig.server.json --noEmit`
Expected: install succeeds; typecheck passes (no source files yet → no errors).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig*.json
git -c commit.gpgsign=false commit -m "chore: bootstrap package and tsconfig"
```

### Task 0.2: [BE] Vitest, ESLint, Prettier, gitignore

**Files:**
- Create: `/Users/ziyu/Projects/better-review/vitest.config.ts`
- Create: `/Users/ziyu/Projects/better-review/.eslintrc.cjs`
- Create: `/Users/ziyu/Projects/better-review/.prettierrc`
- Modify: `/Users/ziyu/Projects/better-review/.gitignore`

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    setupFiles: [],
  },
});
```

- [ ] **Step 2: Write `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: ["dist", "node_modules", "coverage", ".vite"],
  rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
};
```

- [ ] **Step 3: Write `.prettierrc`**

```json
{ "semi": true, "singleQuote": false, "trailingComma": "all", "printWidth": 100 }
```

- [ ] **Step 4: Append to `.gitignore`**

Append these lines:
```
playwright-report/
test-results/
.tmp/
```

- [ ] **Step 5: Add a smoke test**

Create `/Users/ziyu/Projects/better-review/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs", () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 6: Run vitest**

Run: `npm test`
Expected: 1 test passes.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts .eslintrc.cjs .prettierrc .gitignore tests/smoke.test.ts
git -c commit.gpgsign=false commit -m "chore: add vitest, eslint, prettier"
```

**Phase 0 verification:** `npm install && npm test && npx tsc -p tsconfig.server.json --noEmit`

---

## Phase 1: Shared types [BE]

### Task 1.1: [BE] Define `Finding` JSON schema

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/shared/findings-schema.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/shared/findings-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { findingSchema, findingsFileSchema } from "../../src/shared/findings-schema";

describe("findingSchema", () => {
  const valid = {
    id: "R1",
    severity: "must",
    category: "Security",
    file: "src/x.ts",
    line: 10,
    title: "t",
    body: "b",
  };
  it("accepts valid finding", () => {
    expect(findingSchema.parse(valid)).toMatchObject(valid);
  });
  it("rejects bad severity", () => {
    expect(() => findingSchema.parse({ ...valid, severity: "wat" })).toThrow();
  });
  it("allows null file/line for review-body finding", () => {
    expect(findingSchema.parse({ ...valid, file: null, line: null })).toBeTruthy();
  });
  it("findingsFileSchema parses array", () => {
    expect(findingsFileSchema.parse([valid])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- findings-schema`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement schema**

```ts
import { z } from "zod";

export const severitySchema = z.enum(["must", "should", "nit"]);

export const findingSchema = z.object({
  id: z.string().min(1),
  severity: severitySchema,
  category: z.string().min(1),
  file: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  title: z.string().min(1),
  body: z.string().min(1),
  suggestion: z.string().optional(),
});

export const findingsFileSchema = z.array(findingSchema);

export type FindingFromClaude = z.infer<typeof findingSchema>;
export type Severity = z.infer<typeof severitySchema>;
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- findings-schema`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/findings-schema.ts tests/shared/findings-schema.test.ts
git -c commit.gpgsign=false commit -m "feat(shared): add finding zod schema"
```

### Task 1.2: [BE] Define shared API types

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/shared/types.ts`

- [ ] **Step 1: Write the file**

```ts
import type { FindingFromClaude, Severity } from "./findings-schema";

export type SessionStatus = "running" | "ready" | "failed" | "submitted" | "archived" | "pending";

export interface PRSession {
  id: string;
  owner: string;
  repo: string;
  number: number;
  title: string | null;
  author: string | null;
  url: string | null;
  baseRef: string | null;
  headRef: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  workdir: string;
  promptUsed: string;
  error: string | null;
}

export interface Finding extends FindingFromClaude {
  dbId: string;
  sessionId: string;
  ord: number;
  selected: boolean;
  edited: boolean;
  archived: boolean;
  createdAt: number;
}

export type ReviewEvent = "COMMENT" | "REQUEST_CHANGES" | "APPROVE";

export interface Submission {
  id: string;
  sessionId: string;
  event: ReviewEvent;
  githubUrl: string | null;
  payloadJson: string;
  findingIds: string[];
  submittedAt: number;
  error: string | null;
}

export interface HealthStatus {
  ok: boolean;
  claude: { found: boolean; path?: string };
  gh: { found: boolean; path?: string; authed: boolean };
  daemon: { pid: number; port: number; startedAt: number };
}

export type SSEEvent =
  | { type: "progress"; sessionId: string; phase: string; detail?: string }
  | { type: "finding-added"; sessionId: string; finding: Finding }
  | { type: "finding-updated"; sessionId: string; finding: Finding }
  | { type: "status-changed"; sessionId: string; status: SessionStatus; error?: string }
  | { type: "error"; sessionId: string; message: string }
  | { type: "done"; sessionId: string }
  | { type: "shutting-down" };

export interface CreateSessionRequest { prInput: string }
export interface SubmitRequest { event: ReviewEvent; body?: string }
export interface UpdateFindingRequest {
  severity?: Severity;
  title?: string;
  body?: string;
  suggestion?: string | null;
  file?: string | null;
  line?: number | null;
}
export interface SelectFindingRequest { selected: boolean }
export type PromptScope = "global" | "project" | "cwd";
export interface PromptStateResponse {
  effective: { source: PromptScope | "builtin"; content: string };
  scopes: Record<PromptScope, { exists: boolean; content: string | null; path: string }>;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git -c commit.gpgsign=false commit -m "feat(shared): add core API and domain types"
```

**Phase 1 verification:** `npm test -- shared && npx tsc -p tsconfig.server.json --noEmit`

---

## Phase 2: Paths + config [BE]

### Task 2.1: [BE] Path helpers

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/paths.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePaths } from "../../src/server/paths";

describe("resolvePaths", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "br-")); });
  it("returns absolute paths under home dir", () => {
    const p = resolvePaths(home);
    expect(p.home).toBe(home);
    expect(p.serverJson).toBe(join(home, "server.json"));
    expect(p.dbFile).toBe(join(home, "state.db"));
    expect(p.sessionsDir).toBe(join(home, "sessions"));
    expect(p.configFile).toBe(join(home, "config.json"));
    expect(p.daemonLog).toBe(join(home, "daemon.log"));
  });
  it("uses BETTER_REVIEW_HOME env when no arg", () => {
    process.env.BETTER_REVIEW_HOME = home;
    expect(resolvePaths().home).toBe(home);
    delete process.env.BETTER_REVIEW_HOME;
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- paths.test`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { homedir } from "node:os";
import { join } from "node:path";

export interface Paths {
  home: string;
  serverJson: string;
  configFile: string;
  dbFile: string;
  sessionsDir: string;
  promptsDir: string;
  promptHome: string;
  daemonLog: string;
}

export function resolvePaths(home?: string): Paths {
  const h = home ?? process.env.BETTER_REVIEW_HOME ?? join(homedir(), ".better-review");
  return {
    home: h,
    serverJson: join(h, "server.json"),
    configFile: join(h, "config.json"),
    dbFile: join(h, "state.db"),
    sessionsDir: join(h, "sessions"),
    promptsDir: join(h, "prompts"),
    promptHome: join(h, "review.md"),
    daemonLog: join(h, "daemon.log"),
  };
}

export function projectPromptPath(cwd: string): string {
  return join(cwd, ".better-review", "review.md");
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- paths.test`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/paths.ts tests/server/paths.test.ts
git -c commit.gpgsign=false commit -m "feat(server): add path helpers"
```

### Task 2.2: [BE] Config loader

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/config.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, defaultConfig } from "../../src/server/config";

describe("loadConfig", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "br-cfg-")); });
  it("returns defaults when file missing", () => {
    expect(loadConfig(home)).toEqual(defaultConfig);
  });
  it("merges user overrides", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ port: 8765, maxConcurrentReviews: 2 }));
    const c = loadConfig(home);
    expect(c.port).toBe(8765);
    expect(c.maxConcurrentReviews).toBe(2);
    expect(c.idleShutdownMinutes).toBe(defaultConfig.idleShutdownMinutes);
  });
  it("rejects unknown keys silently (strips)", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ foo: 1, port: 1234 }));
    const c = loadConfig(home);
    expect((c as any).foo).toBeUndefined();
    expect(c.port).toBe(1234);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- config.test`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  port: z.number().int().nonnegative().default(0),
  idleShutdownMinutes: z.number().int().positive().default(240),
  maxConcurrentReviews: z.number().int().positive().default(4),
  claudeStallMinutes: z.number().int().positive().default(3),
  perPRGCDays: z.number().int().nonnegative().default(7),
});

export type Config = z.infer<typeof configSchema>;

export const defaultConfig: Config = configSchema.parse({});

export function loadConfig(home: string): Config {
  const file = join(home, "config.json");
  if (!existsSync(file)) return defaultConfig;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return configSchema.parse(raw);
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- config.test`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts tests/server/config.test.ts
git -c commit.gpgsign=false commit -m "feat(server): add config loader with zod defaults"
```

### Task 2.3: [BE] Logger

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/logger.ts`

- [ ] **Step 1: Write file**

```ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Logger {
  info(msg: string, ctx?: unknown): void;
  warn(msg: string, ctx?: unknown): void;
  error(msg: string, ctx?: unknown): void;
}

export function createLogger(file: string): Logger {
  mkdirSync(dirname(file), { recursive: true });
  const write = (level: string, msg: string, ctx?: unknown) => {
    const line = JSON.stringify({ ts: Date.now(), level, msg, ctx }) + "\n";
    try { appendFileSync(file, line); } catch { /* ignore */ }
    if (level === "error" || level === "warn") process.stderr.write(line);
  };
  return {
    info: (m, c) => write("info", m, c),
    warn: (m, c) => write("warn", m, c),
    error: (m, c) => write("error", m, c),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/logger.ts
git -c commit.gpgsign=false commit -m "feat(server): add file logger"
```

**Phase 2 verification:** `npm test -- server && npx tsc -p tsconfig.server.json --noEmit`

---

## Phase 3: SQLite layer [BE]

### Task 3.1: [BE] Initial migration SQL

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/db/migrations/0001_init.sql`

- [ ] **Step 1: Write SQL (per spec §6.5)**

```sql
CREATE TABLE pr_sessions (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,
  repo        TEXT NOT NULL,
  number      INTEGER NOT NULL,
  title       TEXT,
  author      TEXT,
  url         TEXT,
  base_ref    TEXT,
  head_ref    TEXT,
  status      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  workdir     TEXT NOT NULL,
  prompt_used TEXT NOT NULL,
  error       TEXT
);
CREATE INDEX idx_sessions_status ON pr_sessions(status);
CREATE INDEX idx_sessions_pr ON pr_sessions(owner, repo, number);

CREATE TABLE findings (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES pr_sessions(id) ON DELETE CASCADE,
  ord          INTEGER NOT NULL,
  severity     TEXT NOT NULL,
  category     TEXT NOT NULL,
  file         TEXT,
  line         INTEGER,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  suggestion   TEXT,
  selected     INTEGER NOT NULL DEFAULT 1,
  edited       INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_findings_session_active ON findings(session_id, archived);

CREATE TABLE submissions (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES pr_sessions(id),
  event        TEXT NOT NULL,
  github_url   TEXT,
  payload_json TEXT NOT NULL,
  finding_ids  TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  error        TEXT
);
```

- [ ] **Step 2: Commit**

```bash
git add src/server/db/migrations/0001_init.sql
git -c commit.gpgsign=false commit -m "feat(db): add initial schema migration"
```

### Task 3.2: [BE] Migration runner

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/db/migrations.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/db/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../../../src/server/db/migrations";

describe("runMigrations", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "br-mig-"));
    mkdirSync(join(dir, "migrations"), { recursive: true });
  });

  it("applies SQL files and tracks version", () => {
    writeFileSync(join(dir, "migrations", "0001_init.sql"), "CREATE TABLE foo (id INT);");
    const db = new Database(":memory:");
    runMigrations(db, join(dir, "migrations"));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain("foo");
    expect(tables.map(t => t.name)).toContain("_schema_version");
  });

  it("is idempotent", () => {
    writeFileSync(join(dir, "migrations", "0001_init.sql"), "CREATE TABLE foo (id INT);");
    const db = new Database(":memory:");
    runMigrations(db, join(dir, "migrations"));
    expect(() => runMigrations(db, join(dir, "migrations"))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- migrations.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec("CREATE TABLE IF NOT EXISTS _schema_version (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT version FROM _schema_version").all() as { version: string }[]).map(r => r.version),
  );
  const files = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  const insert = db.prepare("INSERT INTO _schema_version (version, applied_at) VALUES (?, ?)");
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      insert.run(file, Date.now());
    })();
  }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- migrations.test`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/migrations.ts tests/server/db/migrations.test.ts
git -c commit.gpgsign=false commit -m "feat(db): add migration runner"
```

### Task 3.3: [BE] DB connection helper

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/db/connection.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/db/connection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/server/db/connection";

describe("openDatabase", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "br-conn-")); });
  it("opens DB in WAL mode and runs migrations", () => {
    const db = openDatabase(join(dir, "state.db"));
    const mode = db.pragma("journal_mode", { simple: true });
    expect(mode).toBe("wal");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain("pr_sessions");
    expect(tables.map(t => t.name)).toContain("findings");
    expect(tables.map(t => t.name)).toContain("submissions");
    db.close();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- connection.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "migrations");

export function openDatabase(file: string): Database.Database {
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}
```

- [ ] **Step 4: Wire migrations dir to be reachable from src AND dist**

Note: tests run from src via vitest; production runs from `dist/`. The SQL file must be co-located with compiled JS. Add to `package.json` build step a copy hook by editing `tsconfig.server.json` or using `tsx` for runtime. For now, run tests via vitest and add a build-time copy script.

Edit `package.json` `scripts.build:server` to:
```
"build:server": "tsc -p tsconfig.server.json && node -e \"import('node:fs').then(fs=>fs.cpSync('src/server/db/migrations','dist/server/db/migrations',{recursive:true}))\""
```

- [ ] **Step 5: Run test, verify PASS**

Run: `npm test -- connection.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/connection.ts tests/server/db/connection.test.ts package.json
git -c commit.gpgsign=false commit -m "feat(db): add WAL-mode connection helper"
```

### Task 3.4: [BE] Sessions repository

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/db/sessions.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/db/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";

describe("SessionsRepo", () => {
  let repo: SessionsRepo;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "br-sess-"));
    repo = new SessionsRepo(openDatabase(join(dir, "s.db")));
  });

  const sample = {
    id: "s1", owner: "o", repo: "r", number: 1, title: "t", author: "a", url: "u",
    baseRef: "main", headRef: "feat", status: "running" as const, workdir: "/w", promptUsed: "p",
  };

  it("insert + getById round-trip", () => {
    repo.insert(sample);
    const got = repo.getById("s1");
    expect(got?.title).toBe("t");
    expect(got?.status).toBe("running");
  });

  it("list returns all sessions newest-first", () => {
    repo.insert(sample);
    repo.insert({ ...sample, id: "s2", number: 2 });
    expect(repo.list().map(s => s.id)).toEqual(["s2", "s1"]);
  });

  it("findActiveByPR ignores archived", () => {
    repo.insert(sample);
    repo.setStatus("s1", "archived");
    expect(repo.findActiveByPR("o", "r", 1)).toBeNull();
  });

  it("setStatus + setError update timestamps", () => {
    repo.insert(sample);
    const before = repo.getById("s1")!.updatedAt;
    repo.setStatus("s1", "ready");
    repo.setError("s1", "boom");
    const after = repo.getById("s1")!;
    expect(after.status).toBe("ready");
    expect(after.error).toBe("boom");
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- sessions.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type Database from "better-sqlite3";
import type { PRSession, SessionStatus } from "../../shared/types";

export interface NewSessionInput {
  id: string; owner: string; repo: string; number: number;
  title: string | null; author: string | null; url: string | null;
  baseRef: string | null; headRef: string | null;
  status: SessionStatus; workdir: string; promptUsed: string;
}

interface Row {
  id: string; owner: string; repo: string; number: number;
  title: string | null; author: string | null; url: string | null;
  base_ref: string | null; head_ref: string | null;
  status: string; created_at: number; updated_at: number;
  workdir: string; prompt_used: string; error: string | null;
}

function rowToSession(r: Row): PRSession {
  return {
    id: r.id, owner: r.owner, repo: r.repo, number: r.number,
    title: r.title, author: r.author, url: r.url,
    baseRef: r.base_ref, headRef: r.head_ref,
    status: r.status as SessionStatus,
    createdAt: r.created_at, updatedAt: r.updated_at,
    workdir: r.workdir, promptUsed: r.prompt_used, error: r.error,
  };
}

export class SessionsRepo {
  constructor(private db: Database.Database) {}

  insert(s: NewSessionInput): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO pr_sessions
        (id, owner, repo, number, title, author, url, base_ref, head_ref,
         status, created_at, updated_at, workdir, prompt_used, error)
      VALUES (@id, @owner, @repo, @number, @title, @author, @url, @baseRef, @headRef,
              @status, @now, @now, @workdir, @promptUsed, NULL)
    `).run({ ...s, now });
  }

  getById(id: string): PRSession | null {
    const row = this.db.prepare("SELECT * FROM pr_sessions WHERE id=?").get(id) as Row | undefined;
    return row ? rowToSession(row) : null;
  }

  list(): PRSession[] {
    const rows = this.db.prepare("SELECT * FROM pr_sessions ORDER BY created_at DESC").all() as Row[];
    return rows.map(rowToSession);
  }

  findActiveByPR(owner: string, repo: string, number: number): PRSession | null {
    const row = this.db.prepare(
      "SELECT * FROM pr_sessions WHERE owner=? AND repo=? AND number=? AND status != 'archived' ORDER BY created_at DESC LIMIT 1",
    ).get(owner, repo, number) as Row | undefined;
    return row ? rowToSession(row) : null;
  }

  setStatus(id: string, status: SessionStatus): void {
    this.db.prepare("UPDATE pr_sessions SET status=?, updated_at=? WHERE id=?").run(status, Date.now(), id);
  }

  setError(id: string, error: string | null): void {
    this.db.prepare("UPDATE pr_sessions SET error=?, updated_at=? WHERE id=?").run(error, Date.now(), id);
  }

  updateWorkdir(id: string, workdir: string, promptUsed: string): void {
    this.db.prepare("UPDATE pr_sessions SET workdir=?, prompt_used=?, updated_at=? WHERE id=?")
      .run(workdir, promptUsed, Date.now(), id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM pr_sessions WHERE id=?").run(id);
  }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- sessions.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/sessions.ts tests/server/db/sessions.test.ts
git -c commit.gpgsign=false commit -m "feat(db): add sessions repository"
```

### Task 3.5: [BE] Findings repository

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/db/findings.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/db/findings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { FindingsRepo } from "../../../src/server/db/findings";

describe("FindingsRepo", () => {
  let findings: FindingsRepo;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "br-find-"));
    const db = openDatabase(join(dir, "f.db"));
    new SessionsRepo(db).insert({
      id: "s1", owner: "o", repo: "r", number: 1, title: null, author: null, url: null,
      baseRef: null, headRef: null, status: "running", workdir: "/w", promptUsed: "p",
    });
    findings = new FindingsRepo(db);
  });

  it("insertMany + listBySession (active only)", () => {
    findings.insertMany("s1", [
      { id: "R1", severity: "must", category: "Security", file: "a.ts", line: 1, title: "t1", body: "b1" },
      { id: "R2", severity: "nit", category: "Naming", file: null, line: null, title: "t2", body: "b2" },
    ]);
    const list = findings.listBySession("s1", { includeArchived: false });
    expect(list).toHaveLength(2);
    expect(list[0].ord).toBe(1);
    expect(list[1].ord).toBe(2);
    expect(list[0].selected).toBe(true);
  });

  it("setSelected toggles flag", () => {
    findings.insertMany("s1", [{ id: "R1", severity: "must", category: "x", file: null, line: null, title: "t", body: "b" }]);
    const f = findings.listBySession("s1")[0];
    findings.setSelected(f.dbId, false);
    expect(findings.getById(f.dbId)!.selected).toBe(false);
  });

  it("update sets edited=true", () => {
    findings.insertMany("s1", [{ id: "R1", severity: "must", category: "x", file: null, line: null, title: "t", body: "b" }]);
    const f = findings.listBySession("s1")[0];
    findings.update(f.dbId, { title: "new" });
    const got = findings.getById(f.dbId)!;
    expect(got.title).toBe("new");
    expect(got.edited).toBe(true);
  });

  it("archiveAllForSession excludes from active list", () => {
    findings.insertMany("s1", [{ id: "R1", severity: "must", category: "x", file: null, line: null, title: "t", body: "b" }]);
    findings.archiveAllForSession("s1");
    expect(findings.listBySession("s1")).toHaveLength(0);
    expect(findings.listBySession("s1", { includeArchived: true })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- findings.test -- --run`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Finding } from "../../shared/types";
import type { FindingFromClaude } from "../../shared/findings-schema";

interface Row {
  id: string; session_id: string; ord: number; severity: string; category: string;
  file: string | null; line: number | null; title: string; body: string; suggestion: string | null;
  selected: number; edited: number; archived: number; created_at: number;
}

function rowToFinding(r: Row, claudeId: string): Finding {
  return {
    dbId: r.id, sessionId: r.session_id, id: claudeId,
    ord: r.ord, severity: r.severity as Finding["severity"], category: r.category,
    file: r.file, line: r.line, title: r.title, body: r.body,
    suggestion: r.suggestion ?? undefined,
    selected: r.selected === 1, edited: r.edited === 1, archived: r.archived === 1,
    createdAt: r.created_at,
  };
}

export interface UpdateFindingPatch {
  severity?: Finding["severity"];
  title?: string;
  body?: string;
  suggestion?: string | null;
  file?: string | null;
  line?: number | null;
}

export class FindingsRepo {
  constructor(private db: Database.Database) {}

  insertMany(sessionId: string, items: FindingFromClaude[]): Finding[] {
    const now = Date.now();
    const insert = this.db.prepare(`
      INSERT INTO findings (id, session_id, ord, severity, category, file, line, title, body, suggestion, selected, edited, archived, created_at)
      VALUES (@id, @sessionId, @ord, @severity, @category, @file, @line, @title, @body, @suggestion, 1, 0, 0, @now)
    `);
    const inserted: Finding[] = [];
    this.db.transaction(() => {
      const existingMax = (this.db.prepare(
        "SELECT COALESCE(MAX(ord), 0) AS m FROM findings WHERE session_id=? AND archived=0",
      ).get(sessionId) as { m: number }).m;
      items.forEach((it, i) => {
        const dbId = randomUUID();
        const ord = existingMax + i + 1;
        insert.run({
          id: dbId, sessionId, ord,
          severity: it.severity, category: it.category, file: it.file, line: it.line,
          title: it.title, body: it.body, suggestion: it.suggestion ?? null, now,
        });
        inserted.push({
          dbId, sessionId, id: it.id, ord,
          severity: it.severity, category: it.category, file: it.file, line: it.line,
          title: it.title, body: it.body, suggestion: it.suggestion,
          selected: true, edited: false, archived: false, createdAt: now,
        });
      });
    })();
    return inserted;
  }

  listBySession(sessionId: string, opts: { includeArchived?: boolean } = {}): Finding[] {
    const where = opts.includeArchived ? "session_id=?" : "session_id=? AND archived=0";
    const rows = this.db.prepare(`SELECT * FROM findings WHERE ${where} ORDER BY ord ASC`).all(sessionId) as Row[];
    return rows.map(r => rowToFinding(r, "R" + r.ord));
  }

  getById(dbId: string): Finding | null {
    const r = this.db.prepare("SELECT * FROM findings WHERE id=?").get(dbId) as Row | undefined;
    return r ? rowToFinding(r, "R" + r.ord) : null;
  }

  update(dbId: string, patch: UpdateFindingPatch): void {
    const cur = this.getById(dbId);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.db.prepare(`
      UPDATE findings SET severity=?, title=?, body=?, suggestion=?, file=?, line=?, edited=1
      WHERE id=?
    `).run(next.severity, next.title, next.body, next.suggestion ?? null, next.file, next.line, dbId);
  }

  setSelected(dbId: string, selected: boolean): void {
    this.db.prepare("UPDATE findings SET selected=? WHERE id=?").run(selected ? 1 : 0, dbId);
  }

  setArchived(dbId: string, archived: boolean): void {
    this.db.prepare("UPDATE findings SET archived=? WHERE id=?").run(archived ? 1 : 0, dbId);
  }

  archiveAllForSession(sessionId: string): void {
    this.db.prepare("UPDATE findings SET archived=1 WHERE session_id=? AND archived=0").run(sessionId);
  }

  delete(dbId: string): void {
    this.db.prepare("DELETE FROM findings WHERE id=?").run(dbId);
  }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- findings.test`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/findings.ts tests/server/db/findings.test.ts
git -c commit.gpgsign=false commit -m "feat(db): add findings repository"
```

### Task 3.6: [BE] Submissions repository

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/db/submissions.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/db/submissions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { SubmissionsRepo } from "../../../src/server/db/submissions";

describe("SubmissionsRepo", () => {
  let repo: SubmissionsRepo;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "br-sub-"));
    const db = openDatabase(join(dir, "s.db"));
    new SessionsRepo(db).insert({
      id: "s1", owner: "o", repo: "r", number: 1, title: null, author: null, url: null,
      baseRef: null, headRef: null, status: "ready", workdir: "/w", promptUsed: "p",
    });
    repo = new SubmissionsRepo(db);
  });

  it("insert + listBySession", () => {
    const id = repo.insert({
      sessionId: "s1", event: "COMMENT", githubUrl: "https://gh/x",
      payloadJson: "{}", findingIds: ["a", "b"], error: null,
    });
    const list = repo.listBySession("s1");
    expect(list[0].id).toBe(id);
    expect(list[0].findingIds).toEqual(["a", "b"]);
    expect(list[0].event).toBe("COMMENT");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- submissions.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Submission, ReviewEvent } from "../../shared/types";

export interface NewSubmission {
  sessionId: string;
  event: ReviewEvent;
  githubUrl: string | null;
  payloadJson: string;
  findingIds: string[];
  error: string | null;
}

interface Row {
  id: string; session_id: string; event: string; github_url: string | null;
  payload_json: string; finding_ids: string; submitted_at: number; error: string | null;
}

function rowToSubmission(r: Row): Submission {
  return {
    id: r.id, sessionId: r.session_id, event: r.event as ReviewEvent,
    githubUrl: r.github_url, payloadJson: r.payload_json,
    findingIds: JSON.parse(r.finding_ids) as string[],
    submittedAt: r.submitted_at, error: r.error,
  };
}

export class SubmissionsRepo {
  constructor(private db: Database.Database) {}

  insert(s: NewSubmission): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO submissions (id, session_id, event, github_url, payload_json, finding_ids, submitted_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, s.sessionId, s.event, s.githubUrl, s.payloadJson, JSON.stringify(s.findingIds), Date.now(), s.error);
    return id;
  }

  listBySession(sessionId: string): Submission[] {
    const rows = this.db.prepare(
      "SELECT * FROM submissions WHERE session_id=? ORDER BY submitted_at DESC",
    ).all(sessionId) as Row[];
    return rows.map(rowToSubmission);
  }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- submissions.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/submissions.ts tests/server/db/submissions.test.ts
git -c commit.gpgsign=false commit -m "feat(db): add submissions repository"
```

**Phase 3 verification:** `npm test -- db && npx tsc -p tsconfig.server.json --noEmit`

---

## Phase 4: PR target parser [BE]

### Task 4.1: [BE] Parse PR input strings

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/github/pr-target-parser.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/github/pr-target-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parsePRTarget } from "../../../src/server/github/pr-target-parser";

describe("parsePRTarget", () => {
  it("parses bare number with default repo", () => {
    expect(parsePRTarget("123", { defaultOwner: "o", defaultRepo: "r" }))
      .toEqual({ owner: "o", repo: "r", number: 123 });
  });
  it("parses owner/repo#num", () => {
    expect(parsePRTarget("foo/bar#42")).toEqual({ owner: "foo", repo: "bar", number: 42 });
  });
  it("parses GitHub URL", () => {
    expect(parsePRTarget("https://github.com/foo/bar/pull/7"))
      .toEqual({ owner: "foo", repo: "bar", number: 7 });
  });
  it("rejects bare number without default repo", () => {
    expect(() => parsePRTarget("123")).toThrow(/repo/);
  });
  it("rejects gibberish", () => {
    expect(() => parsePRTarget("???")).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- pr-target-parser`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export interface PRTarget { owner: string; repo: string; number: number }

export interface ParseOpts { defaultOwner?: string; defaultRepo?: string }

const URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const SHORT_RE = /^([^/]+)\/([^/#]+)#(\d+)$/;
const NUM_RE = /^(\d+)$/;

export function parsePRTarget(input: string, opts: ParseOpts = {}): PRTarget {
  const trimmed = input.trim();
  let m = URL_RE.exec(trimmed);
  if (m) return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
  m = SHORT_RE.exec(trimmed);
  if (m) return { owner: m[1]!, repo: m[2]!, number: Number(m[3]) };
  m = NUM_RE.exec(trimmed);
  if (m) {
    if (!opts.defaultOwner || !opts.defaultRepo) {
      throw new Error("Bare PR number requires default owner/repo (run inside a git repo or use owner/repo#N).");
    }
    return { owner: opts.defaultOwner, repo: opts.defaultRepo, number: Number(m[1]) };
  }
  throw new Error(`Cannot parse PR target: ${input}`);
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- pr-target-parser`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/github/pr-target-parser.ts tests/server/github/pr-target-parser.test.ts
git -c commit.gpgsign=false commit -m "feat(gh): add PR target parser"
```

**Phase 4 verification:** `npm test -- pr-target-parser`

---

## Phase 5: gh CLI client [BE]

### Task 5.1: [BE] Typed errors

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/github/errors.ts`

- [ ] **Step 1: Write file**

```ts
export class GhCliMissingError extends Error {
  constructor() { super("gh CLI not found in PATH"); this.name = "GhCliMissingError"; }
}
export class GhAuthError extends Error {
  constructor(msg = "gh not authenticated; run `gh auth login`") { super(msg); this.name = "GhAuthError"; }
}
export class GhPRNotFoundError extends Error {
  constructor(target: string) { super(`PR not found or no access: ${target}`); this.name = "GhPRNotFoundError"; }
}
export class GhSubmitError extends Error {
  public readonly stderr: string;
  constructor(stderr: string) { super(`gh submit failed: ${stderr.slice(0, 500)}`); this.stderr = stderr; this.name = "GhSubmitError"; }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/github/errors.ts
git -c commit.gpgsign=false commit -m "feat(gh): add typed errors"
```

### Task 5.2: [BE] gh client (with shim support)

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/github/gh-client.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/github/gh-client.test.ts`
- Create: `/Users/ziyu/Projects/better-review/tests/fixtures/fake-gh.sh`

- [ ] **Step 1: Write the fake-gh fixture**

Create `tests/fixtures/fake-gh.sh`, mark executable:
```sh
#!/usr/bin/env bash
case "$1" in
  "auth")
    if [[ "$FAKE_GH_AUTHED" == "0" ]]; then echo "not logged in" >&2; exit 1; fi
    echo "Logged in"; exit 0 ;;
  "pr")
    case "$2" in
      "view")
        if [[ "$FAKE_GH_NOTFOUND" == "1" ]]; then echo "GraphQL: Could not resolve" >&2; exit 1; fi
        cat <<'JSON'
{"number":1,"title":"Title","author":{"login":"alice"},"body":"Body","url":"https://github.com/o/r/pull/1","baseRefName":"main","headRefName":"feat"}
JSON
        exit 0 ;;
      "diff")
        echo "diff --git a/x b/x"; echo "@@ -0,0 +1 @@"; echo "+hi"
        exit 0 ;;
    esac ;;
  "api")
    if [[ "$FAKE_GH_SUBMIT_FAIL" == "1" ]]; then echo "HTTP 422" >&2; exit 1; fi
    echo '{"id":99,"html_url":"https://github.com/o/r/pull/1#pullrequestreview-99"}'
    exit 0 ;;
esac
echo "unsupported: $@" >&2; exit 2
```

Make executable:
```bash
chmod +x tests/fixtures/fake-gh.sh
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { GhClient } from "../../../src/server/github/gh-client";
import { GhAuthError, GhPRNotFoundError, GhSubmitError } from "../../../src/server/github/errors";

const FAKE = resolve(__dirname, "../../fixtures/fake-gh.sh");

describe("GhClient", () => {
  beforeEach(() => {
    delete process.env.FAKE_GH_AUTHED;
    delete process.env.FAKE_GH_NOTFOUND;
    delete process.env.FAKE_GH_SUBMIT_FAIL;
  });

  it("authStatus true when fake gh succeeds", async () => {
    const c = new GhClient({ ghPath: FAKE });
    expect(await c.authStatus()).toBe(true);
  });

  it("authStatus false when env says not logged in", async () => {
    process.env.FAKE_GH_AUTHED = "0";
    const c = new GhClient({ ghPath: FAKE });
    expect(await c.authStatus()).toBe(false);
  });

  it("prView returns parsed PRMeta", async () => {
    const c = new GhClient({ ghPath: FAKE });
    const meta = await c.prView({ owner: "o", repo: "r", number: 1 });
    expect(meta.title).toBe("Title");
    expect(meta.author).toBe("alice");
    expect(meta.baseRef).toBe("main");
  });

  it("prView throws GhPRNotFoundError when fake says missing", async () => {
    process.env.FAKE_GH_NOTFOUND = "1";
    const c = new GhClient({ ghPath: FAKE });
    await expect(c.prView({ owner: "o", repo: "r", number: 1 })).rejects.toBeInstanceOf(GhPRNotFoundError);
  });

  it("prDiff returns unifiedDiff string", async () => {
    const c = new GhClient({ ghPath: FAKE });
    const d = await c.prDiff({ owner: "o", repo: "r", number: 1 });
    expect(d.unifiedDiff).toContain("diff --git");
  });

  it("submitReview returns html_url", async () => {
    const c = new GhClient({ ghPath: FAKE });
    const r = await c.submitReview({ owner: "o", repo: "r", number: 1 }, { event: "COMMENT", body: "hi", comments: [] });
    expect(r.html_url).toContain("pullrequestreview");
  });

  it("submitReview throws GhSubmitError on failure", async () => {
    process.env.FAKE_GH_SUBMIT_FAIL = "1";
    const c = new GhClient({ ghPath: FAKE });
    await expect(c.submitReview({ owner: "o", repo: "r", number: 1 }, { event: "COMMENT", body: "x", comments: [] }))
      .rejects.toBeInstanceOf(GhSubmitError);
  });
});
```

- [ ] **Step 3: Run, verify FAIL**

Run: `npm test -- gh-client.test`
Expected: FAIL.

- [ ] **Step 4: Implement**

```ts
import { execa } from "execa";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GhAuthError, GhCliMissingError, GhPRNotFoundError, GhSubmitError } from "./errors";
import type { PRTarget } from "./pr-target-parser";

export interface PRMeta {
  number: number; title: string; author: string | null; body: string;
  url: string; baseRef: string; headRef: string;
}

export interface DiffResult { unifiedDiff: string }

export interface ReviewComment { path: string; line: number; body: string; side?: "RIGHT" | "LEFT" }
export interface ReviewPayload { event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE"; body: string; comments: ReviewComment[] }

export class GhClient {
  private gh: string;
  constructor(opts: { ghPath?: string } = {}) { this.gh = opts.ghPath ?? "gh"; }

  async authStatus(): Promise<boolean> {
    try {
      const r = await execa(this.gh, ["auth", "status"], { reject: false });
      return r.exitCode === 0;
    } catch (e: any) {
      if (e.code === "ENOENT") throw new GhCliMissingError();
      return false;
    }
  }

  async prView(t: PRTarget): Promise<PRMeta> {
    const args = [
      "pr", "view", String(t.number),
      "--repo", `${t.owner}/${t.repo}`,
      "--json", "number,title,author,body,url,baseRefName,headRefName",
    ];
    const r = await execa(this.gh, args, { reject: false });
    if (r.exitCode !== 0) {
      const txt = (r.stderr || "") + (r.stdout || "");
      if (/not found|could not resolve|no .*access|Not Found/i.test(txt)) {
        throw new GhPRNotFoundError(`${t.owner}/${t.repo}#${t.number}`);
      }
      throw new Error(`gh pr view failed: ${txt.slice(0, 500)}`);
    }
    const j = JSON.parse(r.stdout);
    return {
      number: j.number, title: j.title, author: j.author?.login ?? null, body: j.body ?? "",
      url: j.url, baseRef: j.baseRefName, headRef: j.headRefName,
    };
  }

  async prDiff(t: PRTarget): Promise<DiffResult> {
    const r = await execa(this.gh, [
      "pr", "diff", String(t.number), "--repo", `${t.owner}/${t.repo}`,
    ], { reject: false });
    if (r.exitCode !== 0) throw new Error(`gh pr diff failed: ${r.stderr.slice(0, 500)}`);
    return { unifiedDiff: r.stdout };
  }

  async submitReview(t: PRTarget, payload: ReviewPayload): Promise<{ html_url: string; id: number }> {
    const tmpFile = join(tmpdir(), `br-payload-${randomUUID()}.json`);
    writeFileSync(tmpFile, JSON.stringify(payload));
    const r = await execa(this.gh, [
      "api", `repos/${t.owner}/${t.repo}/pulls/${t.number}/reviews`,
      "-X", "POST", "--input", tmpFile,
    ], { reject: false });
    if (r.exitCode !== 0) throw new GhSubmitError(r.stderr || "unknown");
    const j = JSON.parse(r.stdout);
    return { html_url: j.html_url, id: j.id };
  }
}
```

- [ ] **Step 5: Run, verify PASS**

Run: `npm test -- gh-client.test`
Expected: 7 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/github/gh-client.ts tests/server/github/gh-client.test.ts tests/fixtures/fake-gh.sh
git -c commit.gpgsign=false commit -m "feat(gh): add gh CLI client"
```

**Phase 5 verification:** `npm test -- github`

---

## Phase 6: Prompts [BE]

### Task 6.1: [BE] Builtin prompt content

**Files:**
- Create: `/Users/ziyu/Projects/better-review/prompts/builtin.md`
- Create: `/Users/ziyu/Projects/better-review/src/server/prompts/builtin.ts`

- [ ] **Step 1: Write `prompts/builtin.md`**

```markdown
You are a careful PR reviewer.

## PR metadata
{{PR_META}}

## Diff
{{DIFF}}

## Output

You MUST use the Write tool to write a JSON array of findings to: {{FINDINGS_PATH}}

Each finding must conform to this schema:
{{SCHEMA}}

Rules:
- Do NOT print the report to stdout — use the Write tool only.
- IDs are "R1", "R2", ... in order.
- Use `file: null` and `line: null` for cross-file or PR-level findings; those go in the review body.
- `severity` ∈ "must" | "should" | "nit".
```

- [ ] **Step 2: Write `src/server/prompts/builtin.ts`**

```ts
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// In dev/test runs from src; in build runs from dist. Both have prompts/ at repo root via package files.
const candidates = [
  resolve(here, "../../../prompts/builtin.md"),       // src/server/prompts -> repo
  resolve(here, "../../../../prompts/builtin.md"),    // dist/server/prompts -> repo
];

let cached: string | null = null;

export function getBuiltinPrompt(): string {
  if (cached) return cached;
  for (const c of candidates) {
    try { cached = readFileSync(c, "utf8"); return cached; } catch { /* try next */ }
  }
  throw new Error("builtin prompt not found in any candidate path");
}
```

- [ ] **Step 3: Commit**

```bash
git add prompts/builtin.md src/server/prompts/builtin.ts
git -c commit.gpgsign=false commit -m "feat(prompts): add builtin prompt template"
```

### Task 6.2: [BE] Three-level resolver

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/prompts/resolver.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/prompts/resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEffectivePrompt } from "../../../src/server/prompts/resolver";

describe("resolveEffectivePrompt", () => {
  let cwd: string;
  let home: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "br-cwd-"));
    home = mkdtempSync(join(tmpdir(), "br-home-"));
  });

  it("returns builtin when no overrides", () => {
    const r = resolveEffectivePrompt({ cwd, home });
    expect(r.source).toBe("builtin");
    expect(r.content).toContain("{{DIFF}}");
  });

  it("global home overrides builtin", () => {
    writeFileSync(join(home, "review.md"), "GLOBAL");
    const r = resolveEffectivePrompt({ cwd, home });
    expect(r.source).toBe("global");
    expect(r.content).toBe("GLOBAL");
  });

  it("project cwd overrides global", () => {
    writeFileSync(join(home, "review.md"), "GLOBAL");
    mkdirSync(join(cwd, ".better-review"));
    writeFileSync(join(cwd, ".better-review", "review.md"), "PROJECT");
    const r = resolveEffectivePrompt({ cwd, home });
    expect(r.source).toBe("project");
    expect(r.content).toBe("PROJECT");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- prompts/resolver`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getBuiltinPrompt } from "./builtin";

export type PromptSource = "project" | "global" | "builtin";

export interface ResolvedPrompt { source: PromptSource; content: string; path: string | null }

export function resolveEffectivePrompt(opts: { cwd: string; home: string }): ResolvedPrompt {
  const project = join(opts.cwd, ".better-review", "review.md");
  if (existsSync(project)) return { source: "project", content: readFileSync(project, "utf8"), path: project };
  const global = join(opts.home, "review.md");
  if (existsSync(global)) return { source: "global", content: readFileSync(global, "utf8"), path: global };
  return { source: "builtin", content: getBuiltinPrompt(), path: null };
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- prompts/resolver`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/prompts/resolver.ts tests/server/prompts/resolver.test.ts
git -c commit.gpgsign=false commit -m "feat(prompts): add three-level resolver"
```

### Task 6.3: [BE] Renderer

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/prompts/renderer.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/prompts/renderer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { renderPrompt } from "../../../src/server/prompts/renderer";

describe("renderPrompt", () => {
  it("substitutes all variables", () => {
    const tpl = "M: {{PR_META}}\nD: {{DIFF}}\nP: {{FINDINGS_PATH}}\nS: {{SCHEMA}}";
    const out = renderPrompt(tpl, { prMeta: "META", diff: "DIFF", findingsPath: "/p/f.json", schemaJson: "{}" });
    expect(out).toBe("M: META\nD: DIFF\nP: /p/f.json\nS: {}");
  });
  it("leaves unknown placeholders alone", () => {
    expect(renderPrompt("hello {{UNKNOWN}}", { prMeta: "x", diff: "x", findingsPath: "x", schemaJson: "x" }))
      .toBe("hello {{UNKNOWN}}");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- prompts/renderer`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export interface PromptVars {
  prMeta: string;
  diff: string;
  findingsPath: string;
  schemaJson: string;
}

export function renderPrompt(template: string, vars: PromptVars): string {
  return template
    .replaceAll("{{PR_META}}", vars.prMeta)
    .replaceAll("{{DIFF}}", vars.diff)
    .replaceAll("{{FINDINGS_PATH}}", vars.findingsPath)
    .replaceAll("{{SCHEMA}}", vars.schemaJson);
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- prompts/renderer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/prompts/renderer.ts tests/server/prompts/renderer.test.ts
git -c commit.gpgsign=false commit -m "feat(prompts): add renderer"
```

### Task 6.4: [BE] Prompt store (read/write/delete per scope)

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/prompts/store.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/prompts/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromptStore } from "../../../src/server/prompts/store";

describe("PromptStore", () => {
  let cwd: string;
  let home: string;
  let store: PromptStore;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "br-pcwd-"));
    home = mkdtempSync(join(tmpdir(), "br-phome-"));
    store = new PromptStore({ cwd, home });
  });

  it("write/read project scope", () => {
    store.write("project", "PROJECT");
    expect(store.read("project")).toBe("PROJECT");
    expect(existsSync(join(cwd, ".better-review", "review.md"))).toBe(true);
  });

  it("write/read global scope", () => {
    store.write("global", "GLOBAL");
    expect(store.read("global")).toBe("GLOBAL");
  });

  it("delete clears file", () => {
    store.write("project", "X");
    store.delete("project");
    expect(store.read("project")).toBeNull();
  });

  it("rejects writing to cwd alias", () => {
    expect(() => store.write("cwd" as any, "x")).toThrow();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- prompts/store`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type WritableScope = "project" | "global";

export class PromptStore {
  constructor(private opts: { cwd: string; home: string }) {}

  private pathFor(scope: WritableScope): string {
    if (scope === "project") return join(this.opts.cwd, ".better-review", "review.md");
    return join(this.opts.home, "review.md");
  }

  read(scope: WritableScope): string | null {
    const p = this.pathFor(scope);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  }

  write(scope: WritableScope, content: string): void {
    if (scope !== "project" && scope !== "global") throw new Error(`invalid scope: ${scope}`);
    const p = this.pathFor(scope);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }

  delete(scope: WritableScope): void {
    const p = this.pathFor(scope);
    if (existsSync(p)) rmSync(p);
  }

  pathOf(scope: WritableScope): string { return this.pathFor(scope); }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- prompts/store`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/prompts/store.ts tests/server/prompts/store.test.ts
git -c commit.gpgsign=false commit -m "feat(prompts): add per-scope prompt store"
```

**Phase 6 verification:** `npm test -- prompts`

---

## Phase 7: Findings parser [BE]

### Task 7.1: [BE] Parse + validate raw JSON

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/engine/findings-parser.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/engine/findings-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseFindings } from "../../../src/server/engine/findings-parser";

describe("parseFindings", () => {
  const valid = JSON.stringify([{
    id: "R1", severity: "must", category: "Sec", file: "a", line: 1, title: "t", body: "b",
  }]);

  it("returns ok+data for valid input", () => {
    const r = parseFindings(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toHaveLength(1);
  });

  it("returns error on bad JSON", () => {
    const r = parseFindings("{ broken");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/);
  });

  it("returns error on non-array", () => {
    const r = parseFindings(JSON.stringify({ id: "R1" }));
    expect(r.ok).toBe(false);
  });

  it("returns error on schema mismatch", () => {
    const r = parseFindings(JSON.stringify([{ id: "R1", severity: "WAT", category: "x", file: null, line: null, title: "t", body: "b" }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/severity/i);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- findings-parser`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { findingsFileSchema, type FindingFromClaude } from "../../shared/findings-schema";

export type ParseResult =
  | { ok: true; data: FindingFromClaude[] }
  | { ok: false; error: string };

export function parseFindings(raw: string): ParseResult {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { ok: false, error: `JSON parse error: ${(e as Error).message}` }; }
  const result = findingsFileSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return { ok: false, error: `${first?.path.join(".") ?? "$"}: ${first?.message ?? "invalid"}` };
  }
  return { ok: true, data: result.data };
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- findings-parser`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine/findings-parser.ts tests/server/engine/findings-parser.test.ts
git -c commit.gpgsign=false commit -m "feat(engine): add findings parser"
```

**Phase 7 verification:** `npm test -- findings-parser`

---

## Phase 8: SSE event bus [BE]

### Task 8.1: [BE] Typed event emitter

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/engine/events.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/engine/events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { EventBus } from "../../../src/server/engine/events";

describe("EventBus", () => {
  it("delivers session event to per-session and global subscribers", () => {
    const bus = new EventBus();
    const perSession: any[] = [];
    const global: any[] = [];
    const offA = bus.subscribeSession("s1", (e) => perSession.push(e));
    const offB = bus.subscribeGlobal((e) => global.push(e));
    bus.emit({ type: "done", sessionId: "s1" });
    expect(perSession).toHaveLength(1);
    expect(global).toHaveLength(1);
    offA(); offB();
  });

  it("does not leak across sessions", () => {
    const bus = new EventBus();
    const got: any[] = [];
    bus.subscribeSession("s1", (e) => got.push(e));
    bus.emit({ type: "done", sessionId: "s2" });
    expect(got).toHaveLength(0);
  });

  it("global broadcast (no sessionId) reaches global only", () => {
    const bus = new EventBus();
    const session: any[] = []; const global: any[] = [];
    bus.subscribeSession("s1", (e) => session.push(e));
    bus.subscribeGlobal((e) => global.push(e));
    bus.emit({ type: "shutting-down" });
    expect(session).toHaveLength(0);
    expect(global).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- events.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { SSEEvent } from "../../shared/types";

type Handler = (e: SSEEvent) => void;

export class EventBus {
  private sessionHandlers = new Map<string, Set<Handler>>();
  private globalHandlers = new Set<Handler>();

  subscribeSession(sessionId: string, h: Handler): () => void {
    let set = this.sessionHandlers.get(sessionId);
    if (!set) { set = new Set(); this.sessionHandlers.set(sessionId, set); }
    set.add(h);
    return () => { set!.delete(h); if (set!.size === 0) this.sessionHandlers.delete(sessionId); };
  }

  subscribeGlobal(h: Handler): () => void {
    this.globalHandlers.add(h);
    return () => this.globalHandlers.delete(h);
  }

  emit(event: SSEEvent): void {
    if ("sessionId" in event && event.sessionId) {
      const set = this.sessionHandlers.get(event.sessionId);
      set?.forEach(h => { try { h(event); } catch { /* swallow */ } });
    }
    this.globalHandlers.forEach(h => { try { h(event); } catch { /* swallow */ } });
  }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- events.test`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine/events.ts tests/server/engine/events.test.ts
git -c commit.gpgsign=false commit -m "feat(engine): add SSE event bus"
```

**Phase 8 verification:** `npm test -- events`

---

## Phase 9: Engine — stream-json parser [BE]

### Task 9.1: [BE] Line-delimited JSON event parser

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/engine/stream-json.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/engine/stream-json.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { parseStreamJson } from "../../../src/server/engine/stream-json";

describe("parseStreamJson", () => {
  it("emits events for each newline-delimited JSON object", async () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write" }] } }),
      JSON.stringify({ type: "result", subtype: "success" }),
    ].join("\n") + "\n";
    const events: any[] = [];
    const stream = Readable.from([lines]);
    await parseStreamJson(stream, (e) => events.push(e));
    expect(events).toHaveLength(3);
    expect(events[1].type).toBe("assistant");
  });

  it("handles split-across-chunks lines", async () => {
    const events: any[] = [];
    const stream = Readable.from([
      `{"type":"as`,
      `sistant"}\n{"type":"result"}\n`,
    ]);
    await parseStreamJson(stream, (e) => events.push(e));
    expect(events.map(e => e.type)).toEqual(["assistant", "result"]);
  });

  it("calls onError on malformed line", async () => {
    const events: any[] = []; const errors: string[] = [];
    const stream = Readable.from([`{"ok":1}\nBROKEN\n{"ok":2}\n`]);
    await parseStreamJson(stream, (e) => events.push(e), (err) => errors.push(err));
    expect(events).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- stream-json`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { Readable } from "node:stream";

export type StreamEvent = Record<string, unknown> & { type: string };

export async function parseStreamJson(
  stream: Readable,
  onEvent: (e: StreamEvent) => void,
  onError?: (err: string) => void,
): Promise<void> {
  let buf = "";
  for await (const chunk of stream) {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { onEvent(JSON.parse(line) as StreamEvent); }
      catch (e) { onError?.(`stream-json parse error: ${(e as Error).message} on line: ${line.slice(0, 200)}`); }
    }
  }
  const tail = buf.trim();
  if (tail) {
    try { onEvent(JSON.parse(tail) as StreamEvent); }
    catch (e) { onError?.(`stream-json tail parse error: ${(e as Error).message}`); }
  }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- stream-json`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine/stream-json.ts tests/server/engine/stream-json.test.ts
git -c commit.gpgsign=false commit -m "feat(engine): add stream-json parser"
```

**Phase 9 verification:** `npm test -- stream-json`

---

## Phase 10: Engine — findings watcher [BE]

### Task 10.1: [BE] Chokidar-backed file watcher

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/engine/findings-watcher.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/engine/findings-watcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchFindings } from "../../../src/server/engine/findings-watcher";

describe("watchFindings", () => {
  it("invokes onParsed when valid JSON appears", async () => {
    const dir = mkdtempSync(join(tmpdir(), "br-watch-"));
    const file = join(dir, "findings.json");
    const seen: any[] = [];
    const close = await watchFindings(file, (r) => { if (r.ok) seen.push(r.data); });
    writeFileSync(file, JSON.stringify([{
      id: "R1", severity: "must", category: "x", file: null, line: null, title: "t", body: "b",
    }]));
    await new Promise(res => setTimeout(res, 250));
    await close();
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0][0].id).toBe("R1");
  });

  it("invokes onParsed with error result when JSON is invalid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "br-watch-"));
    const file = join(dir, "findings.json");
    const errs: string[] = [];
    const close = await watchFindings(file, (r) => { if (!r.ok) errs.push(r.error); });
    writeFileSync(file, "BROKEN");
    await new Promise(res => setTimeout(res, 250));
    await close();
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- findings-watcher`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import chokidar from "chokidar";
import { readFileSync } from "node:fs";
import { parseFindings, type ParseResult } from "./findings-parser";

export async function watchFindings(
  file: string,
  onParsed: (r: ParseResult) => void,
): Promise<() => Promise<void>> {
  const watcher = chokidar.watch(file, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });
  const handle = () => {
    try {
      const raw = readFileSync(file, "utf8");
      onParsed(parseFindings(raw));
    } catch (e) {
      onParsed({ ok: false, error: `read error: ${(e as Error).message}` });
    }
  };
  watcher.on("add", handle);
  watcher.on("change", handle);
  await new Promise<void>(res => watcher.on("ready", () => res()));
  return async () => { await watcher.close(); };
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- findings-watcher`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine/findings-watcher.ts tests/server/engine/findings-watcher.test.ts
git -c commit.gpgsign=false commit -m "feat(engine): add chokidar findings watcher"
```

**Phase 10 verification:** `npm test -- findings-watcher`

---

## Phase 11: Engine — runner [BE]

### Task 11.1: [BE] Fake claude shim fixture

**Files:**
- Create: `/Users/ziyu/Projects/better-review/tests/fixtures/fake-claude.sh`

- [ ] **Step 1: Write fake-claude shim**

```sh
#!/usr/bin/env bash
# Fake claude CLI for tests.
# Reads -p "..." prompt; expects FINDINGS_PATH="..." line in prompt.
# Writes FAKE_CLAUDE_BODY (env, JSON array) to that path, emits stream-json events.

PROMPT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p) PROMPT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

FINDINGS_PATH=$(echo "$PROMPT" | grep -oE 'FINDINGS_PATH=[^[:space:]]+' | head -n1 | cut -d= -f2)
if [[ -z "$FINDINGS_PATH" ]]; then
  FINDINGS_PATH=$(echo "$PROMPT" | sed -n 's/.*write[^/]*\(\/[^[:space:]]*findings\.json\).*/\1/p' | head -n1)
fi

echo '{"type":"system","subtype":"init"}'
sleep 0.05
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"'"$FINDINGS_PATH"'"}}]}}'

if [[ "$FAKE_CLAUDE_STALL" == "1" ]]; then
  sleep 600
  exit 0
fi

if [[ "$FAKE_CLAUDE_FAIL" == "1" ]]; then
  echo '{"type":"result","subtype":"error_max_turns"}'
  exit 1
fi

if [[ -n "$FAKE_CLAUDE_BODY" ]]; then
  echo "$FAKE_CLAUDE_BODY" > "$FINDINGS_PATH"
else
  cat > "$FINDINGS_PATH" <<'JSON'
[{"id":"R1","severity":"must","category":"Security","file":"a.ts","line":1,"title":"t","body":"b"}]
JSON
fi

sleep 0.05
echo '{"type":"result","subtype":"success"}'
exit 0
```

Make executable:
```bash
chmod +x tests/fixtures/fake-claude.sh
```

- [ ] **Step 2: Commit**

```bash
git add tests/fixtures/fake-claude.sh
git -c commit.gpgsign=false commit -m "test: add fake-claude shim"
```

### Task 11.2: [BE] Runner happy path

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/engine/runner.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/engine/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { FindingsRepo } from "../../../src/server/db/findings";
import { EventBus } from "../../../src/server/engine/events";
import { runReview } from "../../../src/server/engine/runner";

const FAKE_CLAUDE = resolve(__dirname, "../../fixtures/fake-claude.sh");

describe("runReview (happy path)", () => {
  let workdir: string; let sessions: SessionsRepo; let findings: FindingsRepo; let bus: EventBus;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "br-run-"));
    const db = openDatabase(join(dir, "s.db"));
    sessions = new SessionsRepo(db);
    findings = new FindingsRepo(db);
    bus = new EventBus();
    workdir = mkdtempSync(join(tmpdir(), "br-run-wd-"));
    sessions.insert({
      id: "s1", owner: "o", repo: "r", number: 1, title: null, author: null, url: null,
      baseRef: null, headRef: null, status: "running", workdir, promptUsed: "p",
    });
  });

  it("spawns claude, parses findings.json, transitions to ready", async () => {
    const events: any[] = [];
    bus.subscribeGlobal((e) => events.push(e));
    const promptText = `do review. FINDINGS_PATH=${join(workdir, "findings.json")}`;
    writeFileSync(join(workdir, "prompt.txt"), promptText);
    await runReview({
      sessionId: "s1", workdir, prompt: promptText, claudePath: FAKE_CLAUDE,
      sessions, findings, bus, stallMs: 60_000,
    });
    const got = sessions.getById("s1")!;
    expect(got.status).toBe("ready");
    expect(findings.listBySession("s1")).toHaveLength(1);
    expect(events.some(e => e.type === "done")).toBe(true);
    expect(events.some(e => e.type === "finding-added")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- runner.test`
Expected: FAIL.

- [ ] **Step 3: Implement (skeleton, watchdog wired)**

```ts
import { spawn } from "node:child_process";
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionsRepo } from "../db/sessions";
import type { FindingsRepo } from "../db/findings";
import type { EventBus } from "./events";
import { parseStreamJson } from "./stream-json";
import { watchFindings } from "./findings-watcher";

export interface RunReviewArgs {
  sessionId: string;
  workdir: string;
  prompt: string;
  claudePath: string;
  sessions: SessionsRepo;
  findings: FindingsRepo;
  bus: EventBus;
  stallMs: number;
}

export async function runReview(args: RunReviewArgs): Promise<void> {
  const { sessionId, workdir, prompt, claudePath, sessions, findings, bus, stallMs } = args;
  mkdirSync(workdir, { recursive: true });
  const findingsPath = join(workdir, "findings.json");
  const logPath = join(workdir, "claude.log");
  writeFileSync(join(workdir, "prompt.txt"), prompt);

  const seenIds = new Set<string>();
  const stopWatcher = await watchFindings(findingsPath, (result) => {
    if (!result.ok) {
      bus.emit({ type: "error", sessionId, message: result.error });
      return;
    }
    const fresh = result.data.filter(f => !seenIds.has(f.id));
    if (fresh.length === 0) return;
    fresh.forEach(f => seenIds.add(f.id));
    const inserted = findings.insertMany(sessionId, fresh);
    inserted.forEach(f => bus.emit({ type: "finding-added", sessionId, finding: f }));
  });

  const child = spawn(claudePath, ["--output-format", "stream-json", "-p", prompt], {
    cwd: workdir, stdio: ["ignore", "pipe", "pipe"],
  });

  let lastEventAt = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastEventAt > stallMs) {
      bus.emit({ type: "error", sessionId, message: "claude stalled — killing" });
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000);
    }
  }, Math.min(stallMs, 5_000));

  const stdoutPromise = parseStreamJson(child.stdout!, (e) => {
    lastEventAt = Date.now();
    bus.emit({ type: "progress", sessionId, phase: e.type, detail: JSON.stringify(e).slice(0, 200) });
    appendFileSync(logPath, JSON.stringify(e) + "\n");
  }, (err) => appendFileSync(logPath, `[stream-json error] ${err}\n`));

  child.stderr?.on("data", (chunk) => appendFileSync(logPath, chunk));

  const exitCode: number = await new Promise(res => child.once("close", (code) => res(code ?? 0)));
  clearInterval(watchdog);
  await stdoutPromise;
  // give watcher one tick to drain final write
  await new Promise(res => setTimeout(res, 200));
  await stopWatcher();

  const final = findings.listBySession(sessionId);
  if (exitCode === 0 && final.length > 0) {
    sessions.setStatus(sessionId, "ready");
    bus.emit({ type: "status-changed", sessionId, status: "ready" });
    bus.emit({ type: "done", sessionId });
  } else {
    const msg = exitCode !== 0 ? `claude exited ${exitCode}` : "no findings parsed";
    sessions.setError(sessionId, msg);
    sessions.setStatus(sessionId, "failed");
    bus.emit({ type: "status-changed", sessionId, status: "failed", error: msg });
    bus.emit({ type: "error", sessionId, message: msg });
  }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- runner.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine/runner.ts tests/server/engine/runner.test.ts
git -c commit.gpgsign=false commit -m "feat(engine): add review runner"
```

### Task 11.3: [BE] Runner stall + failure paths

**Files:**
- Modify: `/Users/ziyu/Projects/better-review/tests/server/engine/runner.test.ts`

- [ ] **Step 1: Add failing tests**

Append:
```ts
describe("runReview (failure paths)", () => {
  // (same beforeEach as above; copy locally)
  let workdir: string; let sessions: SessionsRepo; let findings: FindingsRepo; let bus: EventBus;
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "br-run-"));
    const db = openDatabase(join(dir, "s.db"));
    sessions = new SessionsRepo(db);
    findings = new FindingsRepo(db);
    bus = new EventBus();
    workdir = mkdtempSync(join(tmpdir(), "br-run-wd-"));
    sessions.insert({
      id: "s2", owner: "o", repo: "r", number: 1, title: null, author: null, url: null,
      baseRef: null, headRef: null, status: "running", workdir, promptUsed: "p",
    });
  });

  it("transitions to failed on non-zero exit", async () => {
    process.env.FAKE_CLAUDE_FAIL = "1";
    try {
      const promptText = `FINDINGS_PATH=${join(workdir, "findings.json")}`;
      await runReview({
        sessionId: "s2", workdir, prompt: promptText, claudePath: FAKE_CLAUDE,
        sessions, findings, bus, stallMs: 60_000,
      });
      expect(sessions.getById("s2")!.status).toBe("failed");
    } finally { delete process.env.FAKE_CLAUDE_FAIL; }
  });

  it("kills stalled claude and marks failed", async () => {
    process.env.FAKE_CLAUDE_STALL = "1";
    try {
      const promptText = `FINDINGS_PATH=${join(workdir, "findings.json")}`;
      await runReview({
        sessionId: "s2", workdir, prompt: promptText, claudePath: FAKE_CLAUDE,
        sessions, findings, bus, stallMs: 200,
      });
      expect(sessions.getById("s2")!.status).toBe("failed");
    } finally { delete process.env.FAKE_CLAUDE_STALL; }
  }, 15_000);
});
```

- [ ] **Step 2: Run, verify PASS**

Run: `npm test -- runner.test`
Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add tests/server/engine/runner.test.ts
git -c commit.gpgsign=false commit -m "test(engine): cover runner stall and failure"
```

**Phase 11 verification:** `npm test -- runner`

---

## Phase 12: Engine — concurrency queue [BE]

### Task 12.1: [BE] FIFO queue with max-active

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/engine/queue.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/engine/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ConcurrencyQueue } from "../../../src/server/engine/queue";

describe("ConcurrencyQueue", () => {
  it("runs up to maxActive in parallel", async () => {
    const q = new ConcurrencyQueue(2);
    let running = 0; let peak = 0;
    const job = async () => {
      running++; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 50));
      running--;
    };
    await Promise.all([q.run("a", job), q.run("b", job), q.run("c", job), q.run("d", job)]);
    expect(peak).toBe(2);
  });

  it("returns same promise for same key while running", async () => {
    const q = new ConcurrencyQueue(2);
    let calls = 0;
    const job = async () => { calls++; await new Promise(r => setTimeout(r, 50)); };
    const p1 = q.run("x", job);
    const p2 = q.run("x", job);
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- queue.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
type Task = () => Promise<void>;

export class ConcurrencyQueue {
  private active = new Map<string, Promise<void>>();
  private pending: Array<{ key: string; task: Task; resolve: () => void; reject: (e: unknown) => void }> = [];

  constructor(private maxActive: number) {}

  run(key: string, task: Task): Promise<void> {
    const existing = this.active.get(key);
    if (existing) return existing;
    if (this.active.size < this.maxActive) {
      const p = task().finally(() => {
        this.active.delete(key);
        this.drain();
      });
      this.active.set(key, p);
      return p;
    }
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ key, task, resolve, reject });
    });
  }

  private drain(): void {
    while (this.active.size < this.maxActive && this.pending.length > 0) {
      const next = this.pending.shift()!;
      if (this.active.has(next.key)) { next.resolve(); continue; }
      const p = next.task().then(next.resolve, next.reject).finally(() => {
        this.active.delete(next.key);
        this.drain();
      });
      this.active.set(next.key, p);
    }
  }

  pendingCount(): number { return this.pending.length; }
  activeCount(): number { return this.active.size; }
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- queue.test`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine/queue.ts tests/server/engine/queue.test.ts
git -c commit.gpgsign=false commit -m "feat(engine): add concurrency queue"
```

**Phase 12 verification:** `npm test -- queue`

---

## Phase 13: HTTP API [BE]

### Task 13.1: [BE] Hono app skeleton + origin middleware

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/api/middleware/origin.ts`
- Create: `/Users/ziyu/Projects/better-review/src/server/api/app.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/api/origin.test.ts`

- [ ] **Step 1: Write origin failing test**

```ts
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
```

- [ ] **Step 2: Implement origin middleware**

```ts
import type { MiddlewareHandler } from "hono";

export function originGuard(getPort: () => number): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("Origin");
    if (!origin) return next();
    const port = getPort();
    const allowed = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    if (!allowed.includes(origin)) {
      return c.json({ error: "forbidden origin" }, 403);
    }
    return next();
  };
}
```

- [ ] **Step 3: Implement app skeleton**

```ts
import { Hono } from "hono";
import { originGuard } from "./middleware/origin";
import type { SessionsRepo } from "../db/sessions";
import type { FindingsRepo } from "../db/findings";
import type { SubmissionsRepo } from "../db/submissions";
import type { EventBus } from "../engine/events";
import type { GhClient } from "../github/gh-client";
import type { PromptStore } from "../prompts/store";
import type { Config } from "../config";

export interface AppDeps {
  sessions: SessionsRepo; findings: FindingsRepo; submissions: SubmissionsRepo;
  bus: EventBus; gh: GhClient; promptStore: PromptStore;
  config: Config; getPort: () => number;
  startSession: (input: string) => Promise<{ id: string }>;
  rerunSession: (id: string) => Promise<void>;
  submitSession: (id: string, event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE", body?: string) => Promise<{ url: string; droppedToBody: string[] }>;
  health: () => Promise<import("../../shared/types").HealthStatus>;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use("*", originGuard(deps.getPort));
  // routes mounted in subsequent tasks
  return app;
}
```

- [ ] **Step 4: Run origin test, verify PASS**

Run: `npm test -- origin.test`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/api/middleware/origin.ts src/server/api/app.ts tests/server/api/origin.test.ts
git -c commit.gpgsign=false commit -m "feat(api): add Hono app skeleton with origin guard"
```

### Task 13.2: [BE] Health route

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/api/routes/health.ts`
- Modify: `/Users/ziyu/Projects/better-review/src/server/api/app.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/api/health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../../../src/server/api/app";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { FindingsRepo } from "../../../src/server/db/findings";
import { SubmissionsRepo } from "../../../src/server/db/submissions";
import { EventBus } from "../../../src/server/engine/events";

function makeDeps() {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), "br-api-")), "s.db"));
  return {
    sessions: new SessionsRepo(db), findings: new FindingsRepo(db), submissions: new SubmissionsRepo(db),
    bus: new EventBus(),
    gh: {} as any, promptStore: {} as any,
    config: { port: 5555, idleShutdownMinutes: 1, maxConcurrentReviews: 1, claudeStallMinutes: 1, perPRGCDays: 1 },
    getPort: () => 5555,
    startSession: async () => ({ id: "x" }),
    rerunSession: async () => {},
    submitSession: async () => ({ url: "https://gh", droppedToBody: [] }),
    health: async () => ({
      ok: true,
      claude: { found: true, path: "/usr/bin/claude" },
      gh: { found: true, path: "/usr/bin/gh", authed: true },
      daemon: { pid: 1, port: 5555, startedAt: 1 },
    }),
  };
}

describe("GET /api/health", () => {
  it("returns health JSON", async () => {
    const app = createApp(makeDeps());
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.gh.authed).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- health.test`
Expected: FAIL (route not mounted).

- [ ] **Step 3: Implement route + mount**

`routes/health.ts`:
```ts
import { Hono } from "hono";
import type { AppDeps } from "../app";

export function healthRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.get("/health", async (c) => c.json(await deps.health()));
  return r;
}
```

In `app.ts`, after `app.use(...)`:
```ts
import { healthRoutes } from "./routes/health";
app.route("/api", healthRoutes(deps));
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- health.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/api/routes/health.ts src/server/api/app.ts tests/server/api/health.test.ts
git -c commit.gpgsign=false commit -m "feat(api): add health route"
```

### Task 13.3: [BE] Sessions routes (list/create/get/delete/rerun)

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/api/routes/sessions.ts`
- Modify: `/Users/ziyu/Projects/better-review/src/server/api/app.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/api/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../../../src/server/api/app";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { FindingsRepo } from "../../../src/server/db/findings";
import { SubmissionsRepo } from "../../../src/server/db/submissions";
import { EventBus } from "../../../src/server/engine/events";

function makeDeps(overrides: any = {}) {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), "br-")), "s.db"));
  return {
    sessions: new SessionsRepo(db), findings: new FindingsRepo(db), submissions: new SubmissionsRepo(db),
    bus: new EventBus(),
    gh: {} as any, promptStore: {} as any,
    config: { port: 1, idleShutdownMinutes: 1, maxConcurrentReviews: 1, claudeStallMinutes: 1, perPRGCDays: 1 },
    getPort: () => 1,
    startSession: overrides.startSession ?? (async () => ({ id: "new1" })),
    rerunSession: overrides.rerunSession ?? (async () => {}),
    submitSession: async () => ({ url: "", droppedToBody: [] }),
    health: async () => ({ ok: true, claude: { found: true }, gh: { found: true, authed: true }, daemon: { pid: 1, port: 1, startedAt: 1 } } as any),
  };
}

describe("sessions API", () => {
  it("POST /api/sessions creates and returns id", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await app.request("/api/sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prInput: "owner/repo#1" }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe("new1");
  });

  it("GET /api/sessions lists", async () => {
    const deps = makeDeps();
    deps.sessions.insert({
      id: "s1", owner: "o", repo: "r", number: 1, title: null, author: null, url: null,
      baseRef: null, headRef: null, status: "running", workdir: "/w", promptUsed: "p",
    });
    const app = createApp(deps);
    const res = await app.request("/api/sessions");
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toHaveLength(1);
  });

  it("GET /api/sessions/:id returns session + findings", async () => {
    const deps = makeDeps();
    deps.sessions.insert({
      id: "s1", owner: "o", repo: "r", number: 1, title: null, author: null, url: null,
      baseRef: null, headRef: null, status: "ready", workdir: "/w", promptUsed: "p",
    });
    deps.findings.insertMany("s1", [{ id: "R1", severity: "must", category: "x", file: null, line: null, title: "t", body: "b" }]);
    const app = createApp(deps);
    const res = await app.request("/api/sessions/s1");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.session.id).toBe("s1");
    expect(j.findings).toHaveLength(1);
  });

  it("DELETE /api/sessions/:id removes from DB", async () => {
    const deps = makeDeps();
    deps.sessions.insert({
      id: "s1", owner: "o", repo: "r", number: 1, title: null, author: null, url: null,
      baseRef: null, headRef: null, status: "ready", workdir: "/w", promptUsed: "p",
    });
    const app = createApp(deps);
    expect((await app.request("/api/sessions/s1", { method: "DELETE" })).status).toBe(204);
    expect(deps.sessions.getById("s1")).toBeNull();
  });

  it("POST /api/sessions/:id/rerun calls rerunSession", async () => {
    let called = false;
    const deps = makeDeps({ rerunSession: async () => { called = true; } });
    deps.sessions.insert({
      id: "s1", owner: "o", repo: "r", number: 1, title: null, author: null, url: null,
      baseRef: null, headRef: null, status: "ready", workdir: "/w", promptUsed: "p",
    });
    const app = createApp(deps);
    const res = await app.request("/api/sessions/s1/rerun", { method: "POST" });
    expect(res.status).toBe(202);
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- sessions.test`
Expected: FAIL.

- [ ] **Step 3: Implement routes**

```ts
import { Hono } from "hono";
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
```

Mount in `app.ts`:
```ts
import { sessionsRoutes } from "./routes/sessions";
app.route("/api", sessionsRoutes(deps));
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- sessions.test`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/api/routes/sessions.ts src/server/api/app.ts tests/server/api/sessions.test.ts
git -c commit.gpgsign=false commit -m "feat(api): add sessions routes"
```

### Task 13.4: [BE] Findings routes (patch/select/delete)

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/api/routes/findings.ts`
- Modify: `/Users/ziyu/Projects/better-review/src/server/api/app.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/api/findings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../../../src/server/api/app";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { FindingsRepo } from "../../../src/server/db/findings";
import { SubmissionsRepo } from "../../../src/server/db/submissions";
import { EventBus } from "../../../src/server/engine/events";

function deps() {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), "br-f-")), "s.db"));
  const d = {
    sessions: new SessionsRepo(db), findings: new FindingsRepo(db), submissions: new SubmissionsRepo(db),
    bus: new EventBus(),
    gh: {} as any, promptStore: {} as any,
    config: { port: 1, idleShutdownMinutes: 1, maxConcurrentReviews: 1, claudeStallMinutes: 1, perPRGCDays: 1 },
    getPort: () => 1,
    startSession: async () => ({ id: "" }),
    rerunSession: async () => {},
    submitSession: async () => ({ url: "", droppedToBody: [] }),
    health: async () => ({} as any),
  };
  d.sessions.insert({
    id: "s1", owner: "o", repo: "r", number: 1, title: null, author: null, url: null,
    baseRef: null, headRef: null, status: "ready", workdir: "/w", promptUsed: "p",
  });
  return d;
}

describe("findings API", () => {
  it("PATCH /api/findings/:id updates fields", async () => {
    const d = deps();
    d.findings.insertMany("s1", [{ id: "R1", severity: "must", category: "x", file: null, line: null, title: "t", body: "b" }]);
    const f = d.findings.listBySession("s1")[0];
    const app = createApp(d);
    const res = await app.request(`/api/findings/${f.dbId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "new" }),
    });
    expect(res.status).toBe(200);
    expect(d.findings.getById(f.dbId)!.title).toBe("new");
  });

  it("PATCH /api/findings/:id/select toggles selection", async () => {
    const d = deps();
    d.findings.insertMany("s1", [{ id: "R1", severity: "must", category: "x", file: null, line: null, title: "t", body: "b" }]);
    const f = d.findings.listBySession("s1")[0];
    const app = createApp(d);
    const res = await app.request(`/api/findings/${f.dbId}/select`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ selected: false }),
    });
    expect(res.status).toBe(200);
    expect(d.findings.getById(f.dbId)!.selected).toBe(false);
  });

  it("DELETE /api/findings/:id removes finding", async () => {
    const d = deps();
    d.findings.insertMany("s1", [{ id: "R1", severity: "must", category: "x", file: null, line: null, title: "t", body: "b" }]);
    const f = d.findings.listBySession("s1")[0];
    const app = createApp(d);
    const res = await app.request(`/api/findings/${f.dbId}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(d.findings.getById(f.dbId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- findings (api)`. Expected FAIL.

- [ ] **Step 3: Implement routes**

```ts
import { Hono } from "hono";
import type { AppDeps } from "../app";

export function findingsRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.patch("/findings/:id", async (c) => {
    const id = c.req.param("id");
    const cur = deps.findings.getById(id);
    if (!cur) return c.json({ error: "not found" }, 404);
    const patch = await c.req.json();
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
```

Mount: `app.route("/api", findingsRoutes(deps));`

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- api/findings`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/api/routes/findings.ts src/server/api/app.ts tests/server/api/findings.test.ts
git -c commit.gpgsign=false commit -m "feat(api): add findings patch/select/delete"
```

### Task 13.5: [BE] Prompts routes

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/api/routes/prompts.ts`
- Modify: `/Users/ziyu/Projects/better-review/src/server/api/app.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/api/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../src/server/api/app";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { FindingsRepo } from "../../../src/server/db/findings";
import { SubmissionsRepo } from "../../../src/server/db/submissions";
import { EventBus } from "../../../src/server/engine/events";
import { PromptStore } from "../../../src/server/prompts/store";

function deps() {
  const cwd = mkdtempSync(join(tmpdir(), "br-pcwd-"));
  const home = mkdtempSync(join(tmpdir(), "br-phome-"));
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), "br-pa-")), "s.db"));
  return {
    sessions: new SessionsRepo(db), findings: new FindingsRepo(db), submissions: new SubmissionsRepo(db),
    bus: new EventBus(),
    gh: {} as any,
    promptStore: new PromptStore({ cwd, home }),
    promptCwd: cwd,
    promptHome: home,
    config: { port: 1, idleShutdownMinutes: 1, maxConcurrentReviews: 1, claudeStallMinutes: 1, perPRGCDays: 1 },
    getPort: () => 1,
    startSession: async () => ({ id: "" }),
    rerunSession: async () => {},
    submitSession: async () => ({ url: "", droppedToBody: [] }),
    health: async () => ({} as any),
  };
}

describe("prompts API", () => {
  it("GET /api/prompts returns effective + per-scope state", async () => {
    const d = deps();
    const app = createApp(d as any);
    const res = await app.request("/api/prompts");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.effective.source).toBe("builtin");
    expect(j.scopes.global.exists).toBe(false);
  });

  it("PUT /api/prompts/:scope writes file", async () => {
    const d = deps();
    const app = createApp(d as any);
    const res = await app.request("/api/prompts/global", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "GLOBAL" }),
    });
    expect(res.status).toBe(200);
    expect(d.promptStore.read("global")).toBe("GLOBAL");
  });

  it("DELETE /api/prompts/:scope removes file", async () => {
    const d = deps();
    d.promptStore.write("global", "X");
    const app = createApp(d as any);
    const res = await app.request("/api/prompts/global", { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(d.promptStore.read("global")).toBeNull();
  });
});
```

- [ ] **Step 2: Extend `AppDeps` with `promptCwd: string; promptHome: string;`**

In `src/server/api/app.ts`, add to `AppDeps`:
```ts
promptCwd: string;
promptHome: string;
```

- [ ] **Step 3: Run, verify FAIL**

Run: `npm test -- prompts.test`
Expected: FAIL.

- [ ] **Step 4: Implement routes**

```ts
import { Hono } from "hono";
import type { AppDeps } from "../app";
import { resolveEffectivePrompt } from "../../prompts/resolver";

export function promptsRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.get("/prompts", (c) => {
    const eff = resolveEffectivePrompt({ cwd: deps.promptCwd, home: deps.promptHome });
    const project = deps.promptStore.read("project");
    const global = deps.promptStore.read("global");
    return c.json({
      effective: { source: eff.source, content: eff.content },
      scopes: {
        project: { exists: project !== null, content: project, path: deps.promptStore.pathOf("project") },
        global: { exists: global !== null, content: global, path: deps.promptStore.pathOf("global") },
        cwd: { exists: project !== null, content: project, path: deps.promptStore.pathOf("project") },
      },
    });
  });
  r.put("/prompts/:scope", async (c) => {
    const scope = c.req.param("scope");
    if (scope !== "project" && scope !== "global") return c.json({ error: "invalid scope" }, 400);
    const { content } = await c.req.json<{ content: string }>();
    deps.promptStore.write(scope, content);
    return c.json({ ok: true });
  });
  r.delete("/prompts/:scope", (c) => {
    const scope = c.req.param("scope");
    if (scope !== "project" && scope !== "global") return c.json({ error: "invalid scope" }, 400);
    deps.promptStore.delete(scope);
    return c.body(null, 204);
  });
  return r;
}
```

Mount: `app.route("/api", promptsRoutes(deps));`

- [ ] **Step 5: Run, verify PASS**

Run: `npm test -- prompts.test`
Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/api/routes/prompts.ts src/server/api/app.ts tests/server/api/prompts.test.ts
git -c commit.gpgsign=false commit -m "feat(api): add prompts routes"
```

### Task 13.6: [BE] SSE events route

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/api/routes/events.ts`
- Modify: `/Users/ziyu/Projects/better-review/src/server/api/app.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/api/events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../../../src/server/api/app";
import { EventBus } from "../../../src/server/engine/events";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { FindingsRepo } from "../../../src/server/db/findings";
import { SubmissionsRepo } from "../../../src/server/db/submissions";

function deps() {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), "br-e-")), "s.db"));
  return {
    sessions: new SessionsRepo(db), findings: new FindingsRepo(db), submissions: new SubmissionsRepo(db),
    bus: new EventBus(),
    gh: {} as any, promptStore: {} as any,
    promptCwd: "/", promptHome: "/",
    config: { port: 1, idleShutdownMinutes: 1, maxConcurrentReviews: 1, claudeStallMinutes: 1, perPRGCDays: 1 },
    getPort: () => 1,
    startSession: async () => ({ id: "" }),
    rerunSession: async () => {},
    submitSession: async () => ({ url: "", droppedToBody: [] }),
    health: async () => ({} as any),
  };
}

describe("SSE", () => {
  it("GET /api/events streams emitted events", async () => {
    const d = deps();
    const app = createApp(d as any);
    const res = await app.request("/api/events");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    setTimeout(() => d.bus.emit({ type: "done", sessionId: "s1" }), 20);
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("data:");
    expect(text).toContain('"done"');
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- api/events`
Expected: FAIL.

- [ ] **Step 3: Implement route**

```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppDeps } from "../app";

export function eventsRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.get("/events", (c) => streamSSE(c, async (stream) => {
    let id = 0;
    const off = deps.bus.subscribeGlobal((e) => {
      stream.writeSSE({ id: String(++id), event: e.type, data: JSON.stringify(e) });
    });
    c.req.raw.signal.addEventListener("abort", () => off());
    while (!c.req.raw.signal.aborted) await stream.sleep(15_000);
  }));
  r.get("/sessions/:id/events", (c) => streamSSE(c, async (stream) => {
    const sid = c.req.param("id");
    let id = 0;
    const off = deps.bus.subscribeSession(sid, (e) => {
      stream.writeSSE({ id: String(++id), event: e.type, data: JSON.stringify(e) });
    });
    c.req.raw.signal.addEventListener("abort", () => off());
    while (!c.req.raw.signal.aborted) await stream.sleep(15_000);
  }));
  return r;
}
```

Mount in `app.ts`: `app.route("/api", eventsRoutes(deps));`

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- api/events`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/api/routes/events.ts src/server/api/app.ts tests/server/api/events.test.ts
git -c commit.gpgsign=false commit -m "feat(api): add SSE event streams"
```

**Phase 13 verification:** `npm test -- api`

---

## Phase 14: Submit flow [BE]

### Task 14.1: [BE] Diff line validator

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/engine/diff-line-validator.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/engine/diff-line-validator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isLineInDiff } from "../../../src/server/engine/diff-line-validator";

const SAMPLE = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -10,3 +10,5 @@
 ctx
 ctx
+new1
+new2
 ctx
diff --git a/bar.ts b/bar.ts
--- a/bar.ts
+++ b/bar.ts
@@ -1,2 +1,3 @@
+only-add
 a
 b
`;

describe("isLineInDiff", () => {
  it("matches added/changed lines on RIGHT side", () => {
    expect(isLineInDiff(SAMPLE, "foo.ts", 12)).toBe(true); // first ctx
    expect(isLineInDiff(SAMPLE, "foo.ts", 13)).toBe(true); // new1 (added)
    expect(isLineInDiff(SAMPLE, "foo.ts", 14)).toBe(true); // new2 (added)
    expect(isLineInDiff(SAMPLE, "bar.ts", 1)).toBe(true);
  });
  it("rejects line outside any hunk", () => {
    expect(isLineInDiff(SAMPLE, "foo.ts", 99)).toBe(false);
    expect(isLineInDiff(SAMPLE, "other.ts", 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- diff-line-validator`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
interface FileHunks { ranges: Array<{ start: number; length: number }> }

function parseDiff(diff: string): Map<string, FileHunks> {
  const map = new Map<string, FileHunks>();
  const lines = diff.split("\n");
  let curFile: string | null = null;
  for (const line of lines) {
    if (line.startsWith("+++ b/")) { curFile = line.slice("+++ b/".length); map.set(curFile, { ranges: [] }); continue; }
    if (line.startsWith("+++ ")) { curFile = null; continue; }
    if (line.startsWith("@@")) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (m && curFile) {
        map.get(curFile)!.ranges.push({ start: Number(m[1]), length: m[2] ? Number(m[2]) : 1 });
      }
    }
  }
  return map;
}

export function isLineInDiff(diff: string, file: string, line: number): boolean {
  const hunks = parseDiff(diff).get(file);
  if (!hunks) return false;
  return hunks.ranges.some(r => line >= r.start && line < r.start + r.length);
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- diff-line-validator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine/diff-line-validator.ts tests/server/engine/diff-line-validator.test.ts
git -c commit.gpgsign=false commit -m "feat(engine): add diff line validator"
```

### Task 14.2: [BE] Payload builder

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/engine/payload-builder.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/engine/payload-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildSubmitPayload } from "../../../src/server/engine/payload-builder";
import type { Finding } from "../../../src/shared/types";

const DIFF = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -10,1 +10,2 @@
 a
+b
`;

function f(over: Partial<Finding>): Finding {
  return {
    dbId: "x", sessionId: "s", id: "R1", ord: 1,
    severity: "must", category: "x", file: null, line: null,
    title: "t", body: "body text",
    selected: true, edited: false, archived: false, createdAt: 1,
    ...over,
  };
}

describe("buildSubmitPayload", () => {
  it("inline finding becomes comment", () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ file: "foo.ts", line: 11 })],
      event: "COMMENT",
    });
    expect(r.payload.comments).toHaveLength(1);
    expect(r.payload.comments[0]).toMatchObject({ path: "foo.ts", line: 11 });
    expect(r.droppedToBody).toHaveLength(0);
  });

  it("file=null finding goes to body", () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ id: "R1", file: null, line: null })],
      event: "COMMENT",
    });
    expect(r.payload.comments).toHaveLength(0);
    expect(r.payload.body).toContain("R1");
  });

  it("line outside diff drops to body", () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ file: "foo.ts", line: 999 })],
      event: "COMMENT",
    });
    expect(r.payload.comments).toHaveLength(0);
    expect(r.droppedToBody).toHaveLength(1);
    expect(r.payload.body).toContain("foo.ts");
  });

  it("includes user-provided body prefix", () => {
    const r = buildSubmitPayload({
      diff: DIFF, findings: [],
      event: "APPROVE",
      userBody: "LGTM!",
    });
    expect(r.payload.body).toContain("LGTM!");
    expect(r.payload.event).toBe("APPROVE");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- payload-builder`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { Finding, ReviewEvent } from "../../shared/types";
import type { ReviewPayload, ReviewComment } from "../github/gh-client";
import { isLineInDiff } from "./diff-line-validator";

export interface BuildArgs {
  diff: string;
  findings: Finding[];
  event: ReviewEvent;
  userBody?: string;
}

export interface BuildResult {
  payload: ReviewPayload;
  droppedToBody: Finding[];
}

function renderFindingMarkdown(f: Finding): string {
  const sevTag = f.severity === "must" ? "[MUST]" : f.severity === "should" ? "[SHOULD]" : "[NIT]";
  const head = `### ${sevTag} ${f.title}${f.file ? ` (${f.file}${f.line ? ":" + f.line : ""})` : ""}`;
  const sug = f.suggestion ? `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`` : "";
  return `${head}\n\n${f.body}${sug}`;
}

export function buildSubmitPayload(args: BuildArgs): BuildResult {
  const comments: ReviewComment[] = [];
  const dropped: Finding[] = [];
  const bodyParts: string[] = [];
  if (args.userBody) bodyParts.push(args.userBody);
  for (const f of args.findings) {
    if (f.file && f.line && isLineInDiff(args.diff, f.file, f.line)) {
      const sug = f.suggestion ? `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\`` : "";
      comments.push({ path: f.file, line: f.line, side: "RIGHT", body: `**[${f.severity.toUpperCase()}]** ${f.title}\n\n${f.body}${sug}` });
    } else if (f.file && f.line) {
      dropped.push(f);
      bodyParts.push(renderFindingMarkdown(f));
    } else {
      bodyParts.push(renderFindingMarkdown(f));
    }
  }
  return {
    payload: { event: args.event, body: bodyParts.join("\n\n---\n\n"), comments },
    droppedToBody: dropped,
  };
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- payload-builder`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/engine/payload-builder.ts tests/server/engine/payload-builder.test.ts
git -c commit.gpgsign=false commit -m "feat(engine): add submit payload builder"
```

### Task 14.3: [BE] Submit orchestrator + route

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/engine/submit.ts`
- Create: `/Users/ziyu/Projects/better-review/src/server/api/routes/submit.ts`
- Modify: `/Users/ziyu/Projects/better-review/src/server/api/app.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/server/api/submit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../src/server/api/app";
import { openDatabase } from "../../../src/server/db/connection";
import { SessionsRepo } from "../../../src/server/db/sessions";
import { FindingsRepo } from "../../../src/server/db/findings";
import { SubmissionsRepo } from "../../../src/server/db/submissions";
import { EventBus } from "../../../src/server/engine/events";
import { submitSession } from "../../../src/server/engine/submit";

const DIFF = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -10,1 +10,2 @@
 a
+b
`;

describe("submit", () => {
  it("orchestrator calls gh, records submission, returns URL + dropped", async () => {
    const wd = mkdtempSync(join(tmpdir(), "br-sub-wd-"));
    writeFileSync(join(wd, "diff.cache"), DIFF);
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), "br-")), "s.db"));
    const sessions = new SessionsRepo(db);
    const findings = new FindingsRepo(db);
    const submissions = new SubmissionsRepo(db);
    sessions.insert({
      id: "s1", owner: "o", repo: "r", number: 1, title: null, author: null, url: null,
      baseRef: null, headRef: null, status: "ready", workdir: wd, promptUsed: "p",
    });
    findings.insertMany("s1", [
      { id: "R1", severity: "must", category: "x", file: "foo.ts", line: 11, title: "t1", body: "b1" },
      { id: "R2", severity: "nit", category: "x", file: "foo.ts", line: 99, title: "t2", body: "b2" },
    ]);
    let received: any = null;
    const gh: any = { submitReview: async (_t: any, p: any) => { received = p; return { html_url: "https://gh", id: 1 }; } };
    const out = await submitSession({
      sessionId: "s1", event: "COMMENT", body: undefined,
      sessions, findings, submissions, gh,
    });
    expect(out.url).toBe("https://gh");
    expect(out.droppedToBody.length).toBe(1);
    expect(received.comments.length).toBe(1);
    expect(submissions.listBySession("s1")).toHaveLength(1);
    expect(sessions.getById("s1")!.status).toBe("submitted");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- submit`
Expected: FAIL.

- [ ] **Step 3: Implement orchestrator**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionsRepo } from "../db/sessions";
import type { FindingsRepo } from "../db/findings";
import type { SubmissionsRepo } from "../db/submissions";
import type { GhClient } from "../github/gh-client";
import type { ReviewEvent } from "../../shared/types";
import { buildSubmitPayload } from "./payload-builder";

export interface SubmitArgs {
  sessionId: string;
  event: ReviewEvent;
  body?: string;
  sessions: SessionsRepo;
  findings: FindingsRepo;
  submissions: SubmissionsRepo;
  gh: GhClient;
}

export async function submitSession(args: SubmitArgs): Promise<{ url: string; droppedToBody: string[] }> {
  const session = args.sessions.getById(args.sessionId);
  if (!session) throw new Error("session not found");
  const all = args.findings.listBySession(args.sessionId);
  const selected = all.filter(f => f.selected);
  const diff = readFileSync(join(session.workdir, "diff.cache"), "utf8");
  const built = buildSubmitPayload({ diff, findings: selected, event: args.event, userBody: args.body });
  try {
    const r = await args.gh.submitReview(
      { owner: session.owner, repo: session.repo, number: session.number },
      built.payload,
    );
    args.submissions.insert({
      sessionId: args.sessionId, event: args.event, githubUrl: r.html_url,
      payloadJson: JSON.stringify(built.payload),
      findingIds: selected.map(f => f.dbId),
      error: null,
    });
    args.sessions.setStatus(args.sessionId, "submitted");
    return { url: r.html_url, droppedToBody: built.droppedToBody.map(f => f.dbId) };
  } catch (e) {
    args.submissions.insert({
      sessionId: args.sessionId, event: args.event, githubUrl: null,
      payloadJson: JSON.stringify(built.payload),
      findingIds: selected.map(f => f.dbId),
      error: (e as Error).message,
    });
    throw e;
  }
}
```

- [ ] **Step 4: Implement route**

```ts
import { Hono } from "hono";
import type { AppDeps } from "../app";

export function submitRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.post("/sessions/:id/submit", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ event: "COMMENT" | "REQUEST_CHANGES" | "APPROVE"; body?: string }>();
    if (!body?.event) return c.json({ error: "event required" }, 400);
    try {
      const out = await deps.submitSession(id, body.event, body.body);
      return c.json(out);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });
  return r;
}
```

Mount: `app.route("/api", submitRoutes(deps));`

- [ ] **Step 5: Run, verify PASS**

Run: `npm test -- submit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/engine/submit.ts src/server/api/routes/submit.ts src/server/api/app.ts tests/server/api/submit.test.ts
git -c commit.gpgsign=false commit -m "feat(submit): add submit orchestrator and route"
```

**Phase 14 verification:** `npm test -- submit && npm test -- payload-builder`

---

## Phase 15: Daemon lifecycle [BE]

### Task 15.1: [BE] Server boot — wire dependencies

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/server/index.ts`
- Create: `/Users/ziyu/Projects/better-review/src/server/start-session.ts`

- [ ] **Step 1: Implement startSession orchestrator**

`src/server/start-session.ts`:
```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SessionsRepo } from "./db/sessions";
import type { FindingsRepo } from "./db/findings";
import type { GhClient } from "./github/gh-client";
import type { EventBus } from "./engine/events";
import type { ConcurrencyQueue } from "./engine/queue";
import type { Config } from "./config";
import { parsePRTarget } from "./github/pr-target-parser";
import { resolveEffectivePrompt } from "./prompts/resolver";
import { renderPrompt } from "./prompts/renderer";
import { runReview } from "./engine/runner";
import { findingsFileSchema } from "../shared/findings-schema";

export interface StartSessionDeps {
  sessions: SessionsRepo;
  findings: FindingsRepo;
  gh: GhClient;
  bus: EventBus;
  queue: ConcurrencyQueue;
  config: Config;
  paths: { home: string; sessionsDir: string };
  cwd: string;
  claudePath: string;
  defaultRepo?: { owner: string; repo: string };
}

export function makeStartSession(deps: StartSessionDeps) {
  return async function startSession(prInput: string): Promise<{ id: string }> {
    const target = parsePRTarget(prInput, {
      defaultOwner: deps.defaultRepo?.owner,
      defaultRepo: deps.defaultRepo?.repo,
    });
    const existing = deps.sessions.findActiveByPR(target.owner, target.repo, target.number);
    if (existing && existing.status !== "failed") return { id: existing.id };

    const meta = await deps.gh.prView(target);
    const diff = await deps.gh.prDiff(target);

    const id = randomUUID();
    const workdir = join(deps.paths.sessionsDir, `pr-${target.owner}-${target.repo}-${target.number}-${id.slice(0, 8)}`);
    mkdirSync(workdir, { recursive: true });
    writeFileSync(join(workdir, "diff.cache"), diff.unifiedDiff);

    const tpl = resolveEffectivePrompt({ cwd: deps.cwd, home: deps.paths.home });
    const prompt = renderPrompt(tpl.content, {
      prMeta: `#${meta.number} ${meta.title} by ${meta.author ?? "?"}\nURL: ${meta.url}\n\n${meta.body}`,
      diff: diff.unifiedDiff,
      findingsPath: join(workdir, "findings.json"),
      schemaJson: JSON.stringify({ description: "Array of findings", item: findingsFileSchema._def }),
    });

    deps.sessions.insert({
      id, owner: target.owner, repo: target.repo, number: target.number,
      title: meta.title, author: meta.author, url: meta.url,
      baseRef: meta.baseRef, headRef: meta.headRef,
      status: "running", workdir, promptUsed: prompt,
    });
    deps.bus.emit({ type: "status-changed", sessionId: id, status: "running" });

    void deps.queue.run(id, () => runReview({
      sessionId: id, workdir, prompt,
      claudePath: deps.claudePath,
      sessions: deps.sessions, findings: deps.findings, bus: deps.bus,
      stallMs: deps.config.claudeStallMinutes * 60_000,
    }));
    return { id };
  };
}
```

- [ ] **Step 2: Implement daemon entrypoint**

`src/server/index.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execaSync } from "execa";
import { serve } from "@hono/node-server";
import { resolvePaths } from "./paths";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { openDatabase } from "./db/connection";
import { SessionsRepo } from "./db/sessions";
import { FindingsRepo } from "./db/findings";
import { SubmissionsRepo } from "./db/submissions";
import { EventBus } from "./engine/events";
import { ConcurrencyQueue } from "./engine/queue";
import { GhClient } from "./github/gh-client";
import { PromptStore } from "./prompts/store";
import { createApp } from "./api/app";
import { makeStartSession } from "./start-session";
import { submitSession } from "./engine/submit";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerHandle {
  port: number;
  pid: number;
  shutdown: () => Promise<void>;
}

export async function startDaemon(opts: { home?: string; cwd?: string } = {}): Promise<ServerHandle> {
  const paths = resolvePaths(opts.home);
  mkdirSync(paths.home, { recursive: true });
  mkdirSync(paths.sessionsDir, { recursive: true });

  const log = createLogger(paths.daemonLog);
  const config = loadConfig(paths.home);
  const db = openDatabase(paths.dbFile);
  const sessions = new SessionsRepo(db);
  const findings = new FindingsRepo(db);
  const submissions = new SubmissionsRepo(db);
  const bus = new EventBus();
  const queue = new ConcurrencyQueue(config.maxConcurrentReviews);
  const gh = new GhClient();
  const cwd = opts.cwd ?? process.cwd();
  const promptStore = new PromptStore({ cwd, home: paths.home });

  const claudePath = which("claude") ?? "claude";

  const startSession = makeStartSession({
    sessions, findings, gh, bus, queue, config,
    paths: { home: paths.home, sessionsDir: paths.sessionsDir }, cwd, claudePath,
  });

  const here = dirname(fileURLToPath(import.meta.url));
  const webDir = join(here, "..", "web");

  let port = 0;
  const deps = {
    sessions, findings, submissions, bus, gh, promptStore,
    promptCwd: cwd, promptHome: paths.home,
    config, getPort: () => port,
    startSession,
    rerunSession: async (id: string) => {
      const s = sessions.getById(id);
      if (!s) throw new Error("not found");
      findings.archiveAllForSession(id);
      const fresh = await startSession(`${s.owner}/${s.repo}#${s.number}`);
      log.info("rerun started", { id, fresh });
    },
    submitSession: (id: string, event: any, body?: string) => submitSession({
      sessionId: id, event, body, sessions, findings, submissions, gh,
    }),
    health: async () => ({
      ok: true,
      claude: { found: !!which("claude"), path: which("claude") ?? undefined },
      gh: {
        found: !!which("gh"),
        path: which("gh") ?? undefined,
        authed: await gh.authStatus().catch(() => false),
      },
      daemon: { pid: process.pid, port, startedAt: Date.now() },
    }),
  };

  const app = createApp(deps);
  // serve static web bundle if it exists
  // (mounted in Phase 23 via separate patch)

  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.port });
  port = (server.address() as any).port;
  writeFileSync(paths.serverJson, JSON.stringify({ pid: process.pid, port, startedAt: Date.now() }));

  // idle timer
  let lastActivity = Date.now();
  bus.subscribeGlobal(() => { lastActivity = Date.now(); });
  const idleTimer = setInterval(() => {
    const idleMs = Date.now() - lastActivity;
    if (idleMs > config.idleShutdownMinutes * 60_000) {
      log.info("idle shutdown");
      void shutdown();
    }
  }, 60_000);

  const shutdown = async (): Promise<void> => {
    clearInterval(idleTimer);
    bus.emit({ type: "shutting-down" });
    server.close();
    db.close();
    if (existsSync(paths.serverJson)) rmSync(paths.serverJson);
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  return { port, pid: process.pid, shutdown };
}

function which(bin: string): string | null {
  try {
    const r = execaSync("which", [bin], { reject: false });
    return r.exitCode === 0 ? r.stdout.trim() : null;
  } catch { return null; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDaemon().then(h => process.stdout.write(`daemon listening on ${h.port}\n`)).catch(e => {
    process.stderr.write(`daemon failed: ${(e as Error).message}\n`); process.exit(1);
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts src/server/start-session.ts
git -c commit.gpgsign=false commit -m "feat(server): wire daemon dependencies and lifecycle"
```

### Task 15.2: [BE] Stale server.json recovery integration test

**Files:**
- Create: `/Users/ziyu/Projects/better-review/tests/server/daemon.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../../src/server/index";

describe("daemon lifecycle", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "br-d-")); });

  it("starts, writes server.json, shuts down cleanly", async () => {
    const h = await startDaemon({ home, cwd: home });
    expect(existsSync(join(home, "server.json"))).toBe(true);
    expect(h.port).toBeGreaterThan(0);
    await h.shutdown();
    expect(existsSync(join(home, "server.json"))).toBe(false);
  });

  it("ignores stale server.json on next start (overwrites)", async () => {
    writeFileSync(join(home, "server.json"), JSON.stringify({ pid: 999999, port: 1, startedAt: 0 }));
    const h = await startDaemon({ home, cwd: home });
    expect(h.port).toBeGreaterThan(0);
    await h.shutdown();
  });
});
```

- [ ] **Step 2: Run, verify PASS**

Run: `npm test -- daemon.test`
Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/server/daemon.test.ts
git -c commit.gpgsign=false commit -m "test(server): cover daemon start/shutdown"
```

**Phase 15 verification:** `npm test -- daemon`

---

## Phase 16: CLI [BE]

### Task 16.1: [BE] Daemon launcher (probe + spawn)

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/cli/daemon-launcher.ts`
- Test: `/Users/ziyu/Projects/better-review/tests/cli/daemon-launcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDaemon, readServerJson } from "../../src/cli/daemon-launcher";
import { startDaemon } from "../../src/server/index";

describe("daemon-launcher", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "br-cli-")); });

  it("returns existing daemon info if alive", async () => {
    const h = await startDaemon({ home, cwd: home });
    const info = await ensureDaemon({ home, spawnFn: async () => { throw new Error("should not spawn"); } });
    expect(info.port).toBe(h.port);
    await h.shutdown();
  });

  it("spawns when no server.json", async () => {
    let called = false;
    const info = await ensureDaemon({
      home,
      spawnFn: async () => {
        called = true;
        const h = await startDaemon({ home, cwd: home });
        return { pid: h.pid, port: h.port };
      },
    });
    expect(called).toBe(true);
    expect(info.port).toBeGreaterThan(0);
    expect(readServerJson(home)?.port).toBe(info.port);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npm test -- daemon-launcher`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ServerInfo { pid: number; port: number; startedAt: number }

export function readServerJson(home: string): ServerInfo | null {
  const p = join(home, "server.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as ServerInfo; }
  catch { return null; }
}

export async function probeHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    return res.ok;
  } catch { return false; }
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
    await new Promise(res => setTimeout(res, opts.pollMs ?? 100));
  }
  throw new Error("daemon failed to become healthy in time");
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `npm test -- daemon-launcher`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/daemon-launcher.ts tests/cli/daemon-launcher.test.ts
git -c commit.gpgsign=false commit -m "feat(cli): add daemon launcher with health probe"
```

### Task 16.2: [BE] CLI commander entry

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/cli/index.ts`

- [ ] **Step 1: Implement**

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";
import { resolvePaths } from "../server/paths";
import { ensureDaemon, readServerJson } from "./daemon-launcher";

const here = dirname(fileURLToPath(import.meta.url));
const daemonScript = join(here, "..", "server", "index.js");

const program = new Command();
program
  .name("better-review")
  .description("Local PR review helper")
  .argument("[pr]", "PR target (number, owner/repo#N, or URL)")
  .option("--stop", "stop running daemon")
  .option("--status", "show daemon status")
  .action(async (pr, opts) => {
    const paths = resolvePaths();
    if (opts.stop) {
      const info = readServerJson(paths.home);
      if (!info) { process.stdout.write("daemon not running\n"); return; }
      try { process.kill(info.pid, "SIGTERM"); }
      catch { rmSync(paths.serverJson, { force: true }); }
      process.stdout.write("stop signal sent\n");
      return;
    }
    if (opts.status) {
      const info = readServerJson(paths.home);
      if (!info) { process.stdout.write("daemon not running\n"); return; }
      process.stdout.write(`pid=${info.pid} port=${info.port} startedAt=${new Date(info.startedAt).toISOString()}\n`);
      return;
    }
    const info = await ensureDaemon({
      home: paths.home,
      spawnFn: async () => {
        const child = spawn(process.execPath, [daemonScript], {
          detached: true, stdio: "ignore", cwd: process.cwd(),
        });
        child.unref();
        // child writes server.json on boot; poll for it
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          await new Promise(res => setTimeout(res, 100));
          const info = readServerJson(paths.home);
          if (info) return info;
        }
        throw new Error("daemon did not start in time");
      },
    });
    const url = pr
      ? `http://127.0.0.1:${info.port}/?pr=${encodeURIComponent(pr)}`
      : `http://127.0.0.1:${info.port}/`;
    if (pr) {
      // create session via API too
      try {
        await fetch(`http://127.0.0.1:${info.port}/api/sessions`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ prInput: pr }),
        });
      } catch { /* ignore */ }
    }
    await open(url);
  });

program.parseAsync().catch(e => {
  process.stderr.write(`error: ${(e as Error).message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git -c commit.gpgsign=false commit -m "feat(cli): add commander entry"
```

**Phase 16 verification:** `npm test -- cli && npx tsc -p tsconfig.server.json --noEmit`

---

## Phase 17: Web bootstrap [FE]

### Task 17.1: [FE] Vite + React + Tailwind + shadcn

**Files:**
- Create: `/Users/ziyu/Projects/better-review/vite.config.ts`
- Create: `/Users/ziyu/Projects/better-review/tailwind.config.ts`
- Create: `/Users/ziyu/Projects/better-review/postcss.config.cjs`
- Create: `/Users/ziyu/Projects/better-review/components.json`
- Create: `/Users/ziyu/Projects/better-review/src/web/index.html`
- Create: `/Users/ziyu/Projects/better-review/src/web/main.tsx`
- Create: `/Users/ziyu/Projects/better-review/src/web/App.tsx`
- Create: `/Users/ziyu/Projects/better-review/src/web/index.css`
- Modify: `/Users/ziyu/Projects/better-review/package.json` (add web deps)

- [ ] **Step 1: Add web dependencies**

In `package.json` `dependencies`:
```
"@tanstack/react-query": "^5.59.0",
"react": "^18.3.1",
"react-dom": "^18.3.1",
"react-router-dom": "^6.27.0",
"clsx": "^2.1.1",
"tailwind-merge": "^2.5.4",
"class-variance-authority": "^0.7.0",
"lucide-react": "^0.453.0"
```

In `devDependencies`:
```
"tailwindcss": "^3.4.14",
"autoprefixer": "^10.4.20",
"postcss": "^8.4.47"
```

Then `npm install`.

- [ ] **Step 2: Write `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: { outDir: resolve(__dirname, "dist/web"), emptyOutDir: true },
  resolve: { alias: { "@": resolve(__dirname, "src/web"), "@shared": resolve(__dirname, "src/shared") } },
  server: { port: 5174, proxy: { "/api": "http://127.0.0.1:7345" } },
});
```

- [ ] **Step 3: Write `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";
export default {
  content: ["src/web/**/*.{ts,tsx,html}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 4: Write `postcss.config.cjs`**

```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 5: Write `components.json` (shadcn config)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/web/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": { "components": "@/components", "utils": "@/lib/utils" }
}
```

- [ ] **Step 6: Write web entry files**

`src/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>better-review</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/web/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`src/web/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { queryClient } from "./lib/queryClient";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter><App /></BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

`src/web/App.tsx`:
```tsx
import { Routes, Route } from "react-router-dom";
export function App() {
  return (
    <div className="min-h-screen flex">
      <main className="flex-1 p-6">
        <Routes>
          <Route path="/" element={<div>Home (TBD next phase)</div>} />
        </Routes>
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Add `lib/utils.ts` (shadcn helper)**

Create `src/web/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

- [ ] **Step 8: Run dev build smoke**

Run: `npm run build:web`
Expected: builds without errors → `dist/web/index.html` exists.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vite.config.ts tailwind.config.ts postcss.config.cjs components.json src/web/
git -c commit.gpgsign=false commit -m "feat(web): bootstrap Vite + React + Tailwind"
```

**Phase 17 verification:** `npm run build:web`

---

## Phase 18: Web infra [FE]

### Task 18.1: [FE] API client + query client

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/lib/api.ts`
- Create: `/Users/ziyu/Projects/better-review/src/web/lib/queryClient.ts`

- [ ] **Step 1: Write API client**

```ts
import type {
  PRSession, Finding, HealthStatus, CreateSessionRequest, SubmitRequest,
  UpdateFindingRequest, SelectFindingRequest, PromptStateResponse,
} from "@shared/types";

class ApiError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () => req<HealthStatus>("/api/health"),
  listSessions: () => req<PRSession[]>("/api/sessions"),
  getSession: (id: string) => req<{ session: PRSession; findings: Finding[] }>(`/api/sessions/${id}`),
  createSession: (b: CreateSessionRequest) => req<{ id: string }>("/api/sessions", { method: "POST", body: JSON.stringify(b) }),
  deleteSession: (id: string) => req<void>(`/api/sessions/${id}`, { method: "DELETE" }),
  rerunSession: (id: string) => req<void>(`/api/sessions/${id}/rerun`, { method: "POST" }),
  updateFinding: (id: string, b: UpdateFindingRequest) => req<Finding>(`/api/findings/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  selectFinding: (id: string, b: SelectFindingRequest) => req<Finding>(`/api/findings/${id}/select`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteFinding: (id: string) => req<void>(`/api/findings/${id}`, { method: "DELETE" }),
  submit: (id: string, b: SubmitRequest) => req<{ url: string; droppedToBody: string[] }>(`/api/sessions/${id}/submit`, { method: "POST", body: JSON.stringify(b) }),
  getPrompts: () => req<PromptStateResponse>("/api/prompts"),
  putPrompt: (scope: "project" | "global", content: string) => req<{ ok: true }>(`/api/prompts/${scope}`, { method: "PUT", body: JSON.stringify({ content }) }),
  deletePrompt: (scope: "project" | "global") => req<void>(`/api/prompts/${scope}`, { method: "DELETE" }),
};

export const queryKeys = {
  health: ["health"] as const,
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  prompts: ["prompts"] as const,
};
```

- [ ] **Step 2: Write `queryClient.ts`**

```ts
import { QueryClient } from "@tanstack/react-query";
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});
```

- [ ] **Step 3: Commit**

```bash
git add src/web/lib/api.ts src/web/lib/queryClient.ts
git -c commit.gpgsign=false commit -m "feat(web): add API client and query client"
```

### Task 18.2: [FE] useSSE hook

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/lib/sse.ts`

- [ ] **Step 1: Write hook**

```ts
import { useEffect } from "react";
import type { SSEEvent } from "@shared/types";

export function useSSE(path: string, onEvent: (e: SSEEvent) => void): void {
  useEffect(() => {
    const es = new EventSource(path);
    const handler = (ev: MessageEvent) => {
      try { onEvent(JSON.parse(ev.data) as SSEEvent); }
      catch { /* ignore */ }
    };
    const types: Array<SSEEvent["type"]> = [
      "progress", "finding-added", "finding-updated", "status-changed",
      "error", "done", "shutting-down",
    ];
    types.forEach(t => es.addEventListener(t, handler as EventListener));
    return () => es.close();
  }, [path]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/lib/sse.ts
git -c commit.gpgsign=false commit -m "feat(web): add useSSE hook"
```

### Task 18.3: [FE] HealthBanner + layout shell

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/components/HealthBanner.tsx`
- Modify: `/Users/ziyu/Projects/better-review/src/web/App.tsx`

- [ ] **Step 1: Write HealthBanner**

```tsx
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";

export function HealthBanner() {
  const { data } = useQuery({ queryKey: queryKeys.health, queryFn: api.health, refetchInterval: 30_000 });
  if (!data) return null;
  const issues: string[] = [];
  if (!data.claude.found) issues.push("`claude` CLI not found in PATH");
  if (!data.gh.found) issues.push("`gh` CLI not found in PATH");
  else if (!data.gh.authed) issues.push("`gh` is not authenticated — run `gh auth login`");
  if (issues.length === 0) return null;
  return (
    <div className="bg-red-600 text-white px-4 py-2 text-sm">
      {issues.join(" · ")}
    </div>
  );
}
```

- [ ] **Step 2: Wire into App**

Replace `App.tsx`:
```tsx
import { Routes, Route } from "react-router-dom";
import { HealthBanner } from "./components/HealthBanner";
export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <HealthBanner />
      <div className="flex flex-1">
        <main className="flex-1 p-6">
          <Routes>
            <Route path="/" element={<div>Home (TBD next phase)</div>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build to confirm**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/HealthBanner.tsx src/web/App.tsx
git -c commit.gpgsign=false commit -m "feat(web): add health banner and layout shell"
```

**Phase 18 verification:** `npm run build:web`

---

## Phase 19: Web — Sidebar + Home [FE]

### Task 19.1: [FE] Sidebar with session list

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/components/Sidebar.tsx`
- Modify: `/Users/ziyu/Projects/better-review/src/web/App.tsx`
- Modify: `/Users/ziyu/Projects/better-review/src/web/lib/sse.ts` (no change; just ensure invalidation hook hook-up below)

- [ ] **Step 1: Write Sidebar**

```tsx
import { Link, NavLink } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useSSE } from "@/lib/sse";
import type { PRSession } from "@shared/types";

function statusColor(s: PRSession["status"]): string {
  switch (s) {
    case "running": return "bg-blue-500";
    case "ready": return "bg-emerald-500";
    case "submitted": return "bg-violet-500";
    case "failed": return "bg-red-500";
    case "archived": return "bg-zinc-500";
    case "pending": return "bg-amber-500";
  }
}

export function Sidebar() {
  const qc = useQueryClient();
  const { data: sessions = [] } = useQuery({ queryKey: queryKeys.sessions, queryFn: api.listSessions });
  useSSE("/api/events", (e) => {
    if (e.type === "status-changed" || e.type === "done" || e.type === "error") {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions });
    }
  });
  return (
    <aside className="w-72 border-r bg-zinc-50 dark:bg-zinc-900 flex flex-col">
      <div className="p-3 border-b">
        <Link to="/" className="font-semibold">better-review</Link>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map(s => (
          <NavLink
            key={s.id} to={`/pr/${s.id}`}
            className={({ isActive }) =>
              `block px-3 py-2 rounded text-sm ${isActive ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${statusColor(s.status)}`} />
              <span className="truncate">{s.owner}/{s.repo}#{s.number}</span>
            </div>
            <div className="text-xs text-zinc-500 truncate">{s.title ?? ""}</div>
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t text-xs">
        <Link to="/prompt" className="hover:underline mr-3">Prompt</Link>
        <Link to="/settings" className="hover:underline">Settings</Link>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Wire Sidebar into App**

```tsx
import { Routes, Route } from "react-router-dom";
import { HealthBanner } from "./components/HealthBanner";
import { Sidebar } from "./components/Sidebar";
import { Home } from "./pages/Home";
export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <HealthBanner />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-6 overflow-auto">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/pr/:id" element={<div>PR detail (TBD)</div>} />
            <Route path="/prompt" element={<div>Prompt (TBD)</div>} />
            <Route path="/settings" element={<div>Settings (TBD)</div>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/web/components/Sidebar.tsx src/web/App.tsx
git -c commit.gpgsign=false commit -m "feat(web): add sidebar with live session status"
```

### Task 19.2: [FE] Home page (input + recent sessions)

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/pages/Home.tsx`

- [ ] **Step 1: Write Home page**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";

export function Home() {
  const [input, setInput] = useState("");
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: sessions = [] } = useQuery({ queryKey: queryKeys.sessions, queryFn: api.listSessions });
  const create = useMutation({
    mutationFn: api.createSession,
    onSuccess: ({ id }) => { qc.invalidateQueries({ queryKey: queryKeys.sessions }); nav(`/pr/${id}`); },
  });
  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Welcome</h1>
        <p className="text-sm text-zinc-500">Enter a PR target to start a review.</p>
      </header>
      <form
        onSubmit={(e) => { e.preventDefault(); if (input.trim()) create.mutate({ prInput: input.trim() }); }}
        className="flex gap-2"
      >
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="123 · owner/repo#42 · https://github.com/..."
          className="flex-1 px-3 py-2 border rounded"
        />
        <button type="submit" className="px-4 py-2 bg-zinc-900 text-white rounded" disabled={create.isPending}>
          {create.isPending ? "Starting…" : "+ New PR"}
        </button>
      </form>
      {create.isError && <div className="text-red-600 text-sm">{(create.error as Error).message}</div>}
      <section>
        <h2 className="text-lg font-semibold mb-2">Recent</h2>
        <ul className="space-y-2">
          {sessions.slice(0, 10).map(s => (
            <li key={s.id} className="border rounded p-3 text-sm flex justify-between">
              <span>{s.owner}/{s.repo}#{s.number} — {s.title ?? "(no title)"}</span>
              <span className="text-zinc-500">{s.status}</span>
            </li>
          ))}
          {sessions.length === 0 && <li className="text-zinc-500 text-sm">No sessions yet.</li>}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Build to confirm**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/web/pages/Home.tsx
git -c commit.gpgsign=false commit -m "feat(web): add Home page with new-PR input"
```

**Phase 19 verification:** `npm run build:web`

---

## Phase 20: Web — PR detail [FE]

### Task 20.1: [FE] Add diff/markdown deps

**Files:**
- Modify: `/Users/ziyu/Projects/better-review/package.json`

- [ ] **Step 1: Add to dependencies**

```
"react-diff-view": "^3.2.1",
"react-markdown": "^9.0.1",
"rehype-highlight": "^7.0.0",
"shiki": "^1.22.2"
```

Run `npm install`.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git -c commit.gpgsign=false commit -m "chore(web): add diff and markdown deps"
```

### Task 20.2: [FE] FindingCard

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/components/FindingCard.tsx`

- [ ] **Step 1: Write component**

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { api, queryKeys } from "@/lib/api";
import type { Finding, PRSession } from "@shared/types";

interface Props { finding: Finding; session: PRSession }

export function FindingCard({ finding, session }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: finding.title, body: finding.body,
    severity: finding.severity, suggestion: finding.suggestion ?? "",
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.session(session.id) });
  const select = useMutation({ mutationFn: () => api.selectFinding(finding.dbId, { selected: !finding.selected }), onSuccess: invalidate });
  const save = useMutation({
    mutationFn: () => api.updateFinding(finding.dbId, {
      title: draft.title, body: draft.body, severity: draft.severity,
      suggestion: draft.suggestion || null,
    }),
    onSuccess: () => { invalidate(); setEditing(false); },
  });
  const remove = useMutation({ mutationFn: () => api.deleteFinding(finding.dbId), onSuccess: invalidate });

  return (
    <div className="border rounded p-3 space-y-2 bg-white dark:bg-zinc-900">
      <header className="flex items-center gap-2">
        <input type="checkbox" checked={finding.selected} onChange={() => select.mutate()} />
        <span className="text-xs px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{finding.severity}</span>
        <span className="text-xs text-zinc-500">{finding.id} · {finding.category}</span>
        {finding.file && (
          <a className="ml-auto text-xs underline" target="_blank" rel="noreferrer"
             href={`${session.url}/files#diff-${encodeURIComponent(finding.file)}${finding.line ? `R${finding.line}` : ""}`}>
            View on GitHub
          </a>
        )}
      </header>
      {!editing ? (
        <div onDoubleClick={() => setEditing(true)} className="cursor-text">
          <h3 className="font-semibold">{finding.title}</h3>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{finding.body}</ReactMarkdown>
          </div>
          {finding.suggestion && (
            <pre className="text-xs bg-zinc-100 dark:bg-zinc-800 p-2 rounded overflow-x-auto"><code>{finding.suggestion}</code></pre>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <input
            className="w-full border rounded px-2 py-1 text-sm"
            value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <select
            className="border rounded px-2 py-1 text-sm"
            value={draft.severity}
            onChange={(e) => setDraft({ ...draft, severity: e.target.value as Finding["severity"] })}
          >
            <option value="must">must</option><option value="should">should</option><option value="nit">nit</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <textarea
              className="border rounded p-2 text-sm h-40 font-mono"
              value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <div className="border rounded p-2 prose prose-sm dark:prose-invert max-w-none overflow-auto h-40">
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{draft.body}</ReactMarkdown>
            </div>
          </div>
          <textarea
            className="w-full border rounded p-2 text-xs h-20 font-mono"
            placeholder="suggestion (optional)" value={draft.suggestion}
            onChange={(e) => setDraft({ ...draft, suggestion: e.target.value })}
          />
          <div className="flex gap-2">
            <button className="px-3 py-1 bg-zinc-900 text-white rounded text-sm" onClick={() => save.mutate()}>Save</button>
            <button className="px-3 py-1 border rounded text-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="ml-auto px-3 py-1 text-red-600 text-sm" onClick={() => remove.mutate()}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/components/FindingCard.tsx
git -c commit.gpgsign=false commit -m "feat(web): add FindingCard"
```

### Task 20.3: [FE] FindingList grouping

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/components/FindingList.tsx`

- [ ] **Step 1: Write component**

```tsx
import type { Finding, PRSession } from "@shared/types";
import { FindingCard } from "./FindingCard";

const SEVERITY_ORDER: Record<Finding["severity"], number> = { must: 0, should: 1, nit: 2 };

interface Props { findings: Finding[]; session: PRSession }

export function FindingList({ findings, session }: Props) {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = f.file ?? "(review body)";
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ord - b.ord);
  }
  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([file, items]) => (
        <section key={file}>
          <h2 className="text-sm font-mono mb-2 text-zinc-600">{file}</h2>
          <div className="space-y-3">
            {items.map(f => <FindingCard key={f.dbId} finding={f} session={session} />)}
          </div>
        </section>
      ))}
      {findings.length === 0 && <div className="text-zinc-500 text-sm">No findings.</div>}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/components/FindingList.tsx
git -c commit.gpgsign=false commit -m "feat(web): add FindingList with grouping"
```

### Task 20.4: [FE] DiffViewer

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/components/DiffViewer.tsx`

- [ ] **Step 1: Write component**

```tsx
import { useMemo, useState } from "react";
import { parseDiff, Diff, Hunk } from "react-diff-view";
import "react-diff-view/style/index.css";

interface Props { unifiedDiff: string; file: string | null; line: number | null }

export function DiffViewer({ unifiedDiff, file, line }: Props) {
  const [expanded, setExpanded] = useState(false);
  const files = useMemo(() => parseDiff(unifiedDiff || ""), [unifiedDiff]);
  if (!file) return <div className="text-xs text-zinc-500">No file context (review-level finding).</div>;
  const fileDiff = files.find(f => (f.newPath ?? "") === file);
  if (!fileDiff) return <div className="text-xs text-zinc-500">File not in diff: {file}</div>;
  const hunks = expanded ? fileDiff.hunks : sliceHunks(fileDiff.hunks, line ?? 0, 10);
  return (
    <div className="border rounded">
      <header className="flex justify-between items-center px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 text-xs font-mono">
        <span>{file}</span>
        <button className="text-zinc-500 hover:underline" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Collapse" : "Expand full hunk"}
        </button>
      </header>
      <Diff viewType="unified" diffType={fileDiff.type} hunks={hunks}>
        {(hs) => hs.map((h: any) => <Hunk key={h.content} hunk={h} />)}
      </Diff>
    </div>
  );
}

function sliceHunks(hunks: any[], anchor: number, ctx: number): any[] {
  return hunks
    .filter(h => anchor >= h.newStart - ctx && anchor <= h.newStart + h.newLines + ctx)
    .map(h => ({
      ...h,
      changes: h.changes.filter((c: any) => {
        const ln = c.newLineNumber ?? c.oldLineNumber ?? 0;
        return ln >= anchor - ctx && ln <= anchor + ctx;
      }),
    }));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/components/DiffViewer.tsx
git -c commit.gpgsign=false commit -m "feat(web): add DiffViewer with slice and expand"
```

### Task 20.5: [FE] PR detail page

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/pages/PRDetail.tsx`
- Modify: `/Users/ziyu/Projects/better-review/src/web/App.tsx`

- [ ] **Step 1: Write page**

```tsx
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import { useSSE } from "@/lib/sse";
import { FindingList } from "@/components/FindingList";
import { SubmitDrawer } from "@/components/SubmitDrawer";

export function PRDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: queryKeys.session(id), queryFn: () => api.getSession(id), enabled: !!id });
  const [submitOpen, setSubmitOpen] = useState(false);
  useSSE(`/api/sessions/${id}/events`, () => qc.invalidateQueries({ queryKey: queryKeys.session(id) }));
  if (isLoading || !data) return <div>Loading…</div>;
  const { session, findings } = data;
  const selectedCount = findings.filter(f => f.selected && !f.archived).length;
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{session.owner}/{session.repo}#{session.number}</h1>
          <a href={session.url ?? "#"} target="_blank" rel="noreferrer" className="text-sm text-zinc-500 hover:underline">{session.title}</a>
        </div>
        <div className="flex gap-2">
          <span className="text-sm text-zinc-500 self-center">{selectedCount} selected</span>
          <button className="px-3 py-1.5 border rounded text-sm" onClick={() => api.rerunSession(id).then(() => qc.invalidateQueries({ queryKey: queryKeys.session(id) }))}>
            Rerun
          </button>
          <button className="px-3 py-1.5 bg-zinc-900 text-white rounded text-sm" disabled={selectedCount === 0} onClick={() => setSubmitOpen(true)}>
            Submit
          </button>
        </div>
      </header>
      {session.error && <div className="bg-red-100 text-red-800 text-sm px-3 py-2 rounded">{session.error}</div>}
      <FindingList findings={findings.filter(f => !f.archived)} session={session} />
      {submitOpen && <SubmitDrawer sessionId={id} onClose={() => setSubmitOpen(false)} />}
    </div>
  );
}
```

- [ ] **Step 2: Wire route**

In `App.tsx`, replace `<Route path="/pr/:id" element={<div>PR detail (TBD)</div>} />` with `<Route path="/pr/:id" element={<PRDetail />} />` and add import.

- [ ] **Step 3: Commit**

```bash
git add src/web/pages/PRDetail.tsx src/web/App.tsx
git -c commit.gpgsign=false commit -m "feat(web): add PR detail page"
```

**Phase 20 verification:** `npm run build:web`

---

## Phase 21: Web — SubmitDrawer [FE]

### Task 21.1: [FE] Submit drawer

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/components/SubmitDrawer.tsx`

- [ ] **Step 1: Write component**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";
import type { ReviewEvent } from "@shared/types";

interface Props { sessionId: string; onClose: () => void }

export function SubmitDrawer({ sessionId, onClose }: Props) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: queryKeys.session(sessionId), queryFn: () => api.getSession(sessionId) });
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");
  const submit = useMutation({
    mutationFn: () => api.submit(sessionId, { event, body: body || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.session(sessionId) }),
  });
  const selected = (data?.findings ?? []).filter(f => f.selected && !f.archived);
  return (
    <div className="fixed inset-0 bg-black/30 flex justify-end z-40" onClick={onClose}>
      <div className="w-[600px] bg-white dark:bg-zinc-950 h-full overflow-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <header className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Submit review</h2>
          <button onClick={onClose} className="text-zinc-500">close</button>
        </header>
        <div className="space-y-2">
          <label className="text-sm">Event type</label>
          <div className="flex gap-2">
            {(["COMMENT", "REQUEST_CHANGES", "APPROVE"] as ReviewEvent[]).map(e => (
              <button key={e}
                className={`px-3 py-1 border rounded text-sm ${event === e ? "bg-zinc-900 text-white" : ""}`}
                onClick={() => setEvent(e)}>{e}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm">Optional body (prepended)</label>
          <textarea className="w-full border rounded p-2 text-sm h-24" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <section>
          <h3 className="text-sm font-semibold mb-1">{selected.length} finding(s) will be submitted</h3>
          <ul className="text-xs space-y-1 max-h-60 overflow-auto">
            {selected.map(f => (
              <li key={f.dbId}>
                <span className="font-mono">{f.id}</span> · {f.severity} · {f.file ?? "(body)"}{f.line ? `:${f.line}` : ""} — {f.title}
              </li>
            ))}
          </ul>
        </section>
        {submit.data && (
          <div className="bg-emerald-100 text-emerald-800 px-3 py-2 rounded text-sm space-y-1">
            <div>Submitted: <a className="underline" href={submit.data.url} target="_blank" rel="noreferrer">{submit.data.url}</a></div>
            {submit.data.droppedToBody.length > 0 && (
              <div className="text-amber-800">{submit.data.droppedToBody.length} finding(s) dropped to review body (line not in diff).</div>
            )}
          </div>
        )}
        {submit.isError && <div className="bg-red-100 text-red-800 px-3 py-2 rounded text-sm">{(submit.error as Error).message}</div>}
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-zinc-900 text-white rounded text-sm" disabled={submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? "Submitting…" : "Confirm submit"}
          </button>
          <button className="px-4 py-2 border rounded text-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to confirm**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/web/components/SubmitDrawer.tsx
git -c commit.gpgsign=false commit -m "feat(web): add SubmitDrawer"
```

**Phase 21 verification:** `npm run build:web`

---

## Phase 22: Web — Prompt editor + Settings [FE]

### Task 22.1: [FE] Prompt editor (three scopes)

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/pages/PromptEditor.tsx`
- Modify: `/Users/ziyu/Projects/better-review/src/web/App.tsx`

- [ ] **Step 1: Write page**

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";

type Scope = "project" | "global";

export function PromptEditor() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: queryKeys.prompts, queryFn: api.getPrompts });
  const [scope, setScope] = useState<Scope>("project");
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.putPrompt(scope, draft ?? ""),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.prompts }); setDraft(null); },
  });
  const reset = useMutation({
    mutationFn: () => api.deletePrompt(scope),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.prompts }); setDraft(null); },
  });
  if (!data) return <div>Loading…</div>;
  const current = draft ?? data.scopes[scope].content ?? "";
  return (
    <div className="space-y-4 max-w-4xl">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Prompt</h1>
        <span className="text-sm text-zinc-500">Effective: <strong>{data.effective.source}</strong></span>
      </header>
      <div className="flex gap-2">
        {(["project", "global"] as Scope[]).map(s => (
          <button key={s} onClick={() => { setScope(s); setDraft(null); }}
            className={`px-3 py-1.5 border rounded text-sm ${scope === s ? "bg-zinc-900 text-white" : ""}`}>
            {s} {data.scopes[s].exists ? "·" : "(empty)"}
          </button>
        ))}
        <button className="ml-auto px-3 py-1.5 border rounded text-sm" disabled={!data.scopes[scope].exists} onClick={() => reset.mutate()}>
          Reset to upper scope
        </button>
      </div>
      <textarea
        className="w-full h-[60vh] border rounded p-3 font-mono text-sm"
        value={current} onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex gap-2">
        <button className="px-4 py-2 bg-zinc-900 text-white rounded text-sm" disabled={draft === null} onClick={() => save.mutate()}>
          Save to {scope}
        </button>
        <span className="text-xs text-zinc-500 self-center">Path: {data.scopes[scope].path}</span>
      </div>
      <section>
        <h2 className="text-sm font-semibold">Effective preview (read-only)</h2>
        <pre className="text-xs bg-zinc-100 dark:bg-zinc-900 p-3 rounded max-h-60 overflow-auto">{data.effective.content}</pre>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire route**

In `App.tsx` replace `<Route path="/prompt" ...>` with `<Route path="/prompt" element={<PromptEditor />} />` and import.

- [ ] **Step 3: Commit**

```bash
git add src/web/pages/PromptEditor.tsx src/web/App.tsx
git -c commit.gpgsign=false commit -m "feat(web): add prompt editor"
```

### Task 22.2: [FE] Settings page (read-only display)

**Files:**
- Create: `/Users/ziyu/Projects/better-review/src/web/pages/Settings.tsx`
- Modify: `/Users/ziyu/Projects/better-review/src/web/App.tsx`

- [ ] **Step 1: Write page**

```tsx
import { useQuery } from "@tanstack/react-query";
import { api, queryKeys } from "@/lib/api";

export function Settings() {
  const { data: health } = useQuery({ queryKey: queryKeys.health, queryFn: api.health });
  return (
    <div className="space-y-4 max-w-xl">
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="text-sm text-zinc-500">
        Edit <code>~/.better-review/config.json</code> to change settings:
      </p>
      <pre className="text-xs bg-zinc-100 dark:bg-zinc-900 p-3 rounded">
{`{
  "port": 0,
  "idleShutdownMinutes": 240,
  "maxConcurrentReviews": 4,
  "claudeStallMinutes": 3,
  "perPRGCDays": 7
}`}
      </pre>
      {health && (
        <section className="text-sm space-y-1">
          <div>daemon pid: <code>{health.daemon.pid}</code></div>
          <div>port: <code>{health.daemon.port}</code></div>
          <div>started: {new Date(health.daemon.startedAt).toLocaleString()}</div>
          <div>claude: <code>{health.claude.path ?? "missing"}</code></div>
          <div>gh: <code>{health.gh.path ?? "missing"}</code> · authed: {String(health.gh.authed)}</div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire route**

Replace `<Route path="/settings" ...>` with `<Route path="/settings" element={<Settings />} />` and import.

- [ ] **Step 3: Commit**

```bash
git add src/web/pages/Settings.tsx src/web/App.tsx
git -c commit.gpgsign=false commit -m "feat(web): add settings page"
```

**Phase 22 verification:** `npm run build:web`

---

## Phase 23: Build pipeline [BE]

### Task 23.1: [BE] Serve `dist/web` from daemon

**Files:**
- Modify: `/Users/ziyu/Projects/better-review/src/server/index.ts`
- Modify: `/Users/ziyu/Projects/better-review/src/server/api/app.ts`

- [ ] **Step 1: Add static file middleware**

In `src/server/api/app.ts`, accept an optional `webDir` and mount `serveStatic`:
```ts
import { serveStatic } from "@hono/node-server/serve-static";
// inside createApp:
if (deps.webDir) {
  app.use("/*", serveStatic({ root: deps.webDir }));
  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html")) return c.html(/* read index.html via fs */ "<!doctype html><div id='root'></div><script type='module' src='/main.js'></script>");
    return c.json({ error: "not found" }, 404);
  });
}
```

Update `AppDeps` to include `webDir?: string`.

- [ ] **Step 2: Implement SPA fallback properly**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

if (deps.webDir && existsSync(join(deps.webDir, "index.html"))) {
  app.use("/*", serveStatic({ root: deps.webDir }));
  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("text/html")) {
      return c.html(readFileSync(join(deps.webDir!, "index.html"), "utf8"));
    }
    return c.json({ error: "not found" }, 404);
  });
}
```

- [ ] **Step 3: Pass webDir from `src/server/index.ts`**

```ts
const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "web"); // dist/web (sibling of dist/server)
```

In `deps`: `webDir`.

- [ ] **Step 4: Update build script to copy migrations + ensure web is built**

In `package.json`:
```
"build": "npm run build:server && npm run build:web && node scripts/copy-assets.mjs"
```

Create `scripts/copy-assets.mjs`:
```js
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("dist/server/db/migrations", { recursive: true });
cpSync("src/server/db/migrations", "dist/server/db/migrations", { recursive: true });
mkdirSync("dist/prompts", { recursive: true });
cpSync("prompts", "dist/prompts", { recursive: true });
```

- [ ] **Step 5: Run full build**

Run: `npm run build`
Expected: `dist/cli/index.js`, `dist/server/index.js`, `dist/web/index.html`, `dist/server/db/migrations/0001_init.sql` all exist.

- [ ] **Step 6: Commit**

```bash
git add src/server/api/app.ts src/server/index.ts package.json scripts/copy-assets.mjs
git -c commit.gpgsign=false commit -m "feat(server): serve web bundle and bundle migrations"
```

### Task 23.2: [BE] CLI bin shebang + executable

**Files:**
- Modify: `/Users/ziyu/Projects/better-review/scripts/copy-assets.mjs`

- [ ] **Step 1: Append chmod step**

```js
import { chmodSync } from "node:fs";
chmodSync("dist/cli/index.js", 0o755);
```

- [ ] **Step 2: Run build**

Run: `npm run build && node dist/cli/index.js --status`
Expected: prints "daemon not running".

- [ ] **Step 3: Commit**

```bash
git add scripts/copy-assets.mjs
git -c commit.gpgsign=false commit -m "chore(build): mark CLI executable"
```

**Phase 23 verification:** `npm run build && node dist/cli/index.js --status`

---

## Phase 24: E2E [BE]

### Task 24.1: [BE] Playwright config

**Files:**
- Create: `/Users/ziyu/Projects/better-review/playwright.config.ts`

- [ ] **Step 1: Write config**

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { headless: true },
});
```

- [ ] **Step 2: Add Playwright browsers**

Run: `npx playwright install chromium`
Expected: chromium installed.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git -c commit.gpgsign=false commit -m "test(e2e): add Playwright config"
```

### Task 24.2: [BE] Happy-path E2E

**Files:**
- Create: `/Users/ziyu/Projects/better-review/tests/e2e/happy-path.spec.ts`

- [ ] **Step 1: Write E2E test**

```ts
import { test, expect } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

let daemon: ChildProcess; let port = 0;

test.beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), "br-e2e-"));
  const fakeBinDir = mkdtempSync(join(tmpdir(), "br-bin-"));
  const fakeGh = resolve("tests/fixtures/fake-gh.sh");
  const fakeClaude = resolve("tests/fixtures/fake-claude.sh");
  // Symlink fixtures into a fake bin path
  // (use existing files; PATH override below).
  const env = {
    ...process.env,
    BETTER_REVIEW_HOME: home,
    PATH: `${resolve("tests/fixtures")}:${process.env.PATH}`,
  };
  // For test we point claude/gh to fixture scripts directly via daemon's `which`,
  // which means we need them named "claude" and "gh" in PATH. Instead, override by
  // copying into a temp dir under those names.
  const { copyFileSync, chmodSync } = await import("node:fs");
  copyFileSync(fakeGh, join(fakeBinDir, "gh"));
  copyFileSync(fakeClaude, join(fakeBinDir, "claude"));
  chmodSync(join(fakeBinDir, "gh"), 0o755);
  chmodSync(join(fakeBinDir, "claude"), 0o755);
  env.PATH = `${fakeBinDir}:${env.PATH}`;
  daemon = spawn(process.execPath, ["dist/server/index.js"], { env, stdio: "pipe" });
  await new Promise<void>(res => daemon.stdout!.on("data", (d) => {
    const m = /listening on (\d+)/.exec(d.toString());
    if (m) { port = Number(m[1]); res(); }
  }));
});

test.afterAll(async () => {
  daemon.kill("SIGTERM");
});

test("create session, see finding, submit", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.fill("input[placeholder*='owner']", "owner/repo#1");
  await page.click("button:has-text('+ New PR')");
  await expect(page.locator("h1")).toContainText("owner/repo#1", { timeout: 30_000 });
  await expect(page.locator("text=R1")).toBeVisible({ timeout: 30_000 });
  await page.click("button:has-text('Submit')");
  await page.click("button:has-text('Confirm submit')");
  await expect(page.locator("text=Submitted:")).toBeVisible({ timeout: 30_000 });
});
```

- [ ] **Step 2: Run E2E**

Run: `npm run build && npm run e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/happy-path.spec.ts
git -c commit.gpgsign=false commit -m "test(e2e): add happy-path Playwright spec"
```

**Phase 24 verification:** `npm run e2e`

---

## Final acceptance verification (per spec §13)

Run by [QA]:

- [ ] `npm install -g .` then `which better-review` → resolves to bin (or `npm run build && node dist/cli/index.js --help`)
- [ ] `better-review` → daemon starts, browser opens at `http://127.0.0.1:<port>/`
- [ ] In UI, enter PR# → after `claude` finishes, ≥1 finding shown
- [ ] Open second PR while first is running → both visible in sidebar; statuses live-update
- [ ] Finding card: checkbox toggles selection; double-click edits; delete works
- [ ] DiffViewer shows ±10 lines around finding; "Expand" reveals full hunk
- [ ] Submit → GitHub returns review URL; banner displays it
- [ ] Out-of-diff finding (line 999) drops to body and amber banner appears
- [ ] Prompt editor: edit project/global scope → save → new review uses it; reset reverts
- [ ] Idle 4h (or set `idleShutdownMinutes: 1` and wait) → daemon exits, server.json removed
- [ ] Kill daemon mid-flight, `better-review --status` → "not running"; next `better-review` invocation respawns

---

## Open decisions noted

These were not fully resolved by the spec; planner chose pragmatic defaults:

1. **`prompt_used` content vs path** — spec says "snapshot"; plan stores rendered prompt text in `pr_sessions.prompt_used`. Consistent with §6.7.
2. **Stale-session de-dup vs failed sessions** — plan retries (creates fresh) when an existing session is `failed`; otherwise returns existing id. Spec §6.3 step 4 only said "去重"; this seems most useful.
3. **Default port** — `0` in config means OS-assigned; CLI reads `server.json` for actual port. Consistent with §9.
4. **CLI argument behavior** — when `better-review <PR>` is given, CLI hits `POST /api/sessions` then opens `/?pr=<input>` so the URL hint is preserved if the user lands on Home before the redirect (defensive for slow daemon boot).
5. **shadcn primitives** — plan uses raw Tailwind elements, not generated shadcn components. Designer will swap in shadcn primitives in a follow-up; this avoids baking in design choices.
6. **Test isolation** — vitest `singleFork: true` to keep SQLite-backed tests serial and avoid file-locking in tmpdirs.













