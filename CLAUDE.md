# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Orientation

`better-review` is a **local PR-review tool**: a Node daemon + React SPA that wraps the `claude` CLI and `gh` CLI. It is distributed as an npm bin (`better-review`) that launches a detached daemon, opens a browser UI, and shells out to those two CLIs for actual work. There is no cloud component, no auth layer, and no multi-user state — everything lives under `~/.better-review/`.

User-facing docs live in `README.md` (Chinese). Read it for end-to-end semantics (PR input formats, submit flow, prompt overrides, config keys). The notes below are about _building and changing_ the code, not using it.

## Common commands

```bash
pnpm run build          # tsc(server) + vite(web) + scripts/copy-assets.mjs
pnpm run dev:server     # tsx watch src/server/index.ts (daemon)
pnpm run dev:web        # Vite dev server on :5174, proxies /api → 127.0.0.1:7345
pnpm run test           # vitest: server + cli + shared (Node env, single fork)
pnpm run test:web       # vitest jsdom: tests/web + src/web component tests
pnpm run e2e            # Playwright happy path (run `pnpm exec playwright install chromium` once)
pnpm run lint           # oxlint
pnpm run format         # oxfmt (writes); `pnpm run format:check` to verify in CI
```

Single-test patterns:

```bash
pnpm exec vitest run tests/server/engine/findings-parser.test.ts
pnpm exec vitest run -t "fragment of test name"
pnpm exec vitest run --config vitest.web.config.ts tests/web/FindingCard.test.tsx
pnpm exec playwright test tests/e2e/<file>.spec.ts
```

The Node-env vitest run is pinned to `pool: "forks"` with `singleFork: true` (see `vitest.config.ts`) because tests share a `better-sqlite3` temp file pattern. Don't parallelize without checking that.

## Build pipeline gotchas

- Three tsconfigs: `tsconfig.server.json` (CLI + server + shared → `dist/`), `tsconfig.web.json` (Vite, `@/` and `@shared/` aliases), `tsconfig.test.json`. Keep server-only and web-only code separated; only `src/shared/` is consumed by both.
- `scripts/copy-assets.mjs` runs after `tsc` and does three things:
  1. Copies `src/server/db/migrations/*.sql` into `dist/server/db/migrations/`.
  2. Copies `prompts/framework.md` and `prompts/builtin-rules.md` to `dist/prompts/`.
  3. **Rewrites relative imports in compiled `.js` to add `.js` extensions** (and folds `./foo` → `./foo/index.js` where applicable). This is required because the package is ESM (`"type": "module"`) but the source uses extensionless imports. Don't manually add `.js` to `.ts` imports — rely on this step.
  4. Chmods `dist/cli/index.js` to 0755 so the bin works after `npm install -g .`.
- Vite builds the SPA to `dist/web/`. The daemon serves it via Hono static middleware (`webDir = dist/web`) — see `src/server/index.ts:67`.

## Architecture

### Process model

```
better-review (CLI)
  └─ checks ~/.better-review/server.json + /api/health
     └─ if dead: spawns detached `node dist/server/index.js`
        └─ daemon: Hono on 127.0.0.1:<port>
                   ├─ /api/* routes
                   ├─ /api/events SSE (per-session + global)
                   └─ static SPA from dist/web
        └─ on POST /api/sessions: orchestrates one review
```

The CLI is a thin launcher (`src/cli/index.ts`, `src/cli/daemon-launcher.ts`). All real logic is in `src/server/`. SPA talks to daemon via `/api/*` (REST + SSE). There is no websocket.

### Review session lifecycle

Source: `src/server/start-session.ts` plus `src/server/engine/`.

1. **Resolve PR target** — `github/pr-target-parser.ts` parses `123` / `owner/repo#N` / URL; numeric form needs `gh repo view` to discover the current remote.
2. **Fetch metadata + diff** — `gh pr view --json` and `gh pr diff` via `github/gh-client.ts` (always `execa`, never raw `child_process`). Diff is cached at `<workdir>/diff.cache`.
3. **Resolve prompt** — `prompts/resolver.ts` walks: project (`<cwd>/.better-review/review.md`) → global (`~/.better-review/review.md`) → builtin (`prompts/builtin.md`). First hit wins; no merging. `prompts/renderer.ts` substitutes `{{PR_META}}`, `{{DIFF}}`, `{{FINDINGS_PATH}}`, `{{SCHEMA}}`.
4. **Spawn claude** — `engine/runner.ts` launches `claude --output-format stream-json -p <rendered>` under a `ConcurrencyQueue` (config `maxConcurrentReviews`, default 4). `engine/stream-json.ts` parses progress events for the UI; a watchdog in the runner kills the process if no event arrives within `claudeStallMinutes`.
5. **Parse findings** — `engine/findings-watcher.ts` uses `chokidar` on `<workdir>/findings.json`. `engine/findings-parser.ts` validates entries against the zod schema in `src/shared/findings-schema.ts` and dedupes by `(file, line, title)`. New rows go through `db/findings.ts` and get broadcast on the SSE bus.
6. **Submit** — `engine/payload-builder.ts` separates inline-eligible findings from PR-wide / off-diff ones (validated by `engine/diff-line-validator.ts`); `engine/submit.ts` POSTs the payload via `gh api repos/.../pulls/<n>/reviews`. No retries.

### Module map

```
src/
  cli/            commander entrypoint + daemon health-probe / detached spawn
  shared/         zod schemas + cross-cutting types (used by web AND server)
  server/
    index.ts          startDaemon(): wires deps, opens Hono, manages idle shutdown
    start-session.ts  factory that closes over deps and returns startSession()
    paths.ts          ~/.better-review path resolution; honors BETTER_REVIEW_HOME
    config.ts         loads/validates config.json with defaults
    api/
      app.ts            Hono app + middleware composition
      routes/           sessions, findings, submit, prompts, events (SSE), health
      middleware/       origin guard (rejects non-localhost), activity bump
    engine/           claude lifecycle, findings ingestion, submit payload
    github/           gh CLI wrapper, PR-target parser, error normalisation
    db/               better-sqlite3; migrations in db/migrations/*.sql
    prompts/          three-tier resolver, mustache-style renderer, file store
  web/              React + Vite SPA
    pages/, components/, lib/  (router-based, TanStack Query against /api/*)
```

The daemon depends on three shell tools at runtime: `claude` (resolved via `which`), `gh`, and `node` itself. The `/api/health` endpoint reports their presence — UI banner reads it on every load.

## Conventions

### Tests

- **Don't mock `better-sqlite3`.** Every server test opens a real DB at a temp path. The migrations module is the source of truth for schema; tests run it on init.
- **Don't mock `claude` or `gh`.** Use the existing shims at `tests/fixtures/fake-claude.sh` and `tests/fixtures/fake-gh.sh` — they emit deterministic stream-json / JSON output and are exercised end-to-end. Add new fixture behaviour to those scripts rather than introducing in-process mocks.
- Vitest server config is single-fork; assume tests share process state and clean up explicitly.
- TDD is the working style for routes and engine code: failing test → implementation → commit. Reflect that in PRs.

### Prompts

This project's review-style prompts (built-in `prompts/builtin.md`, project/global overrides) follow a hard convention:

> **Chinese prose, English code identifiers.** Findings titles, bodies, suggestions, and any natural-language guidance are written in 简体中文. File paths, symbol names, CLI flags, and code snippets stay in English. Apply this when editing `prompts/builtin.md`, when wiring new placeholders, or when generating examples in tests.

### Commits

Conventional Commits, lowercase imperative mood: `feat(scope): …`, `fix(scope): …`, `docs(scope): …`. Recent history is consistent — match it. Common scopes seen so far: `cli`, `server`, `engine`, `web`, `prompts`, `docs`.

### TypeScript settings worth knowing

`tsconfig.json` has `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on. When adding optional fields to interfaces in `src/shared/types.ts`, callers must pass `undefined` explicitly or omit the key — `?: T` is not the same as `?: T | undefined` here. Indexed access (`arr[i]`, `record[key]`) returns `T | undefined`; narrow before use.

### Filesystem layout the daemon owns

`~/.better-review/` (override with `BETTER_REVIEW_HOME`):

```
config.json    state.db    daemon.log    server.json
review.md                              (global prompt)
sessions/pr-<owner>-<repo>-<n>-<short>/
  diff.cache  findings.json  claude.log  prompt.txt
```

`server.json` is the daemon's liveness file — the CLI uses it to decide whether to spawn. Don't change its shape (`{pid, port, startedAt}`) without updating `cli/daemon-launcher.ts` in the same change.
