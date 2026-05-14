# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Orientation

`better-review` is a **local PR-review tool**: a Node daemon + React SPA that drives one of several review-agent CLIs (currently `claude` and `codex`) plus the `gh` CLI. The agent layer is pluggable — see `src/server/engine/agent/`. Distributed as an npm bin (`better-review`) that launches a detached daemon, opens a browser UI, and shells out to those CLIs for actual work. There is no cloud component, no auth layer, and no multi-user state — everything lives under `~/.better-review/`.

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

1. **Resolve PR target** — `github/pr-target-parser.ts` accepts only the canonical HTTPS GitHub PR URL (`https://github.com/<owner>/<repo>/pull/<n>`) and throws on anything else.
2. **Fetch metadata + diff** — `gh pr view --json` and `gh pr diff` via `github/gh-client.ts` (always `execa`, never raw `child_process`). Diff is cached at `<workdir>/diff.cache`.
3. **Resolve prompt** — `prompts/resolver.ts` walks: project (`<localRepoPath>/.better-review/review.md`) → global (`~/.better-review/review.md`) → builtin (`prompts/builtin.md`). First hit wins; no merging. The project tier resolves against the session's selected local repo (`localRepoPath`), **not** the daemon's cwd; when no local repo is pinned the project tier is skipped. `prompts/renderer.ts` substitutes `{{PR_META}}`, `{{DIFF}}`, `{{FINDINGS_PATH}}`, `{{SCHEMA}}`. The framework wording is agent-neutral — it tells the agent to "write a JSON array of findings to {{FINDINGS_PATH}} using whatever file-write capability your runtime provides," not "use the Write tool."
4. **Pick agent** — the session's `agent` field (default `config.defaultAgent`) selects a `ReviewAgent` from `engine/agent/` (`getAgent(kind)`). Each agent owns its own spawn args and stdout parsing.
5. **Spawn agent** — `engine/runner.ts` calls `agent.spawn({ executable, prompt, workdir, logPath, onProgress })` under a `ConcurrencyQueue` (config `maxConcurrentReviews`, default 4). Each `onProgress` tick resets the watchdog; if no tick arrives for `stallMinutes`, the runner SIGTERMs (then SIGKILLs) the child. Implementations:
   - `agent/claude.ts` — `claude --output-format stream-json --verbose -p <prompt>`; ticks once per stream-json event via `engine/stream-json.ts`.
   - `agent/codex.ts` — `codex exec --sandbox workspace-write --skip-git-repo-check --color never -`; prompt is fed via stdin (avoids argv length limits with large diffs); ticks once per stdout line.
6. **Parse findings** — `engine/findings-watcher.ts` uses `chokidar` on `<workdir>/findings.json`. `engine/findings-parser.ts` validates entries against the zod schema in `src/shared/findings-schema.ts` and dedupes by `(file, line, title)`. New rows go through `db/findings.ts` and get broadcast on the SSE bus.
7. **Submit** — `engine/payload-builder.ts` separates inline-eligible findings from PR-wide / off-diff ones (validated by `engine/diff-line-validator.ts`); `engine/submit.ts` POSTs the payload via `gh api repos/.../pulls/<n>/reviews`. No retries.

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
    engine/           agent lifecycle, findings ingestion, submit payload
      agent/          ReviewAgent abstraction + claude / codex provider implementations
    github/           gh CLI wrapper, PR-target parser, error normalisation
    db/               better-sqlite3; migrations in db/migrations/*.sql
    prompts/          three-tier resolver, mustache-style renderer, file store
  web/              React + Vite SPA
    pages/, components/, lib/  (router-based, TanStack Query against /api/*)
```

The daemon depends on these shell tools at runtime: at least one review agent CLI (`claude` and/or `codex`, resolved once at startup via `which`), `gh`, and `node` itself. The `/api/health` endpoint reports presence per agent under `agents.<kind>` and the configured `defaultAgent` — UI banner only fires red when the **default** agent is missing; non-default agents that are missing show as disabled in the Home selector.

## Conventions

### Tests

- **Don't mock `better-sqlite3`.** Every server test opens a real DB at a temp path. The migrations module is the source of truth for schema; tests run it on init.
- **Don't mock agent CLIs or `gh`.** Use the existing shims at `tests/fixtures/fake-claude.sh`, `tests/fixtures/fake-codex.sh`, and `tests/fixtures/fake-gh.sh` — they emit deterministic stream-json / line-oriented / JSON output and are exercised end-to-end. The runner test parameterizes over both agents via `describe.each`. Add new fixture behaviour to those scripts rather than introducing in-process mocks.
- Vitest server config is single-fork; assume tests share process state and clean up explicitly.
- TDD is the working style for routes and engine code: failing test → implementation → commit. Reflect that in PRs.

### Prompts

Built-in prompts are **language-paired**. Every agent-facing prompt has an `<name>.en.md` and an `<name>.zh-CN.md` variant under `prompts/` — currently `framework.en.md` / `framework.zh-CN.md` and `builtin-rules.en.md` / `builtin-rules.zh-CN.md`. `src/server/prompts/builtin.ts` picks a variant based on `config.language`; `src/server/prompts/resolver.ts` threads the language through. Project / global overrides (`<localRepoPath>/.better-review/review.md`, `~/.better-review/review.md`) remain **single-file, user-owned** — the resolver picks them first regardless of language. The project override is keyed to the session's selected local repo, so the prompts API (`GET/PUT/DELETE /api/prompts`) takes a `repo` path for the `project` scope and the PromptEditor SPA carries a repo selector.

When editing prompts:

- Keep both variants in sync: same structure, same `{{PLACEHOLDERS}}`, same number of sections. If you add a new placeholder to one variant, add it to the other too.
- Chinese variants follow the convention: **Chinese prose, English code identifiers** — file paths, symbol names, CLI flags, code snippets, `category` strings (`Scope`, `Correctness`, …), and `severity` values (`must` / `should` / `nit`) all stay English; they are data, not prose.
- Each variant must end with an explicit "output language" directive so findings come back in the correct language.

### Web i18n

The SPA uses **react-i18next** with a single `common` namespace. Dictionaries live at `src/web/i18n/locales/{en,zh-CN}.json`; the entry point that initializes i18next is `src/web/i18n/index.ts`, imported once from `src/web/main.tsx`. When adding a new visible string, add the key to both `en.json` and `zh-CN.json` — `tests/web/i18n.test.tsx` enforces parity. Use `useTranslation()` + `t('group.key')` in components; use `<Trans i18nKey="…" components={[…]} />` when the copy embeds JSX (e.g., `<code>` elements). For interpolation values that are themselves user-visible text, use `{{name}}` inside the message and pass `{ name: value }` as the second argument. The SPA reads `config.language` via TanStack Query at mount and calls `i18n.changeLanguage()` from `src/web/App.tsx`; the Settings page's PUT mutation hot-applies via the same effect.

Notes on stable keys: `nsSeparator: false` is set in the i18next init so colons inside keys (`prep.phase.prep:fetching-pr`) are treated as literal — needed because server-side `PREP_PHASES` values embed `:`.

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
  diff.cache  findings.json  agent.log  prompt.txt
```

The session log is named `agent.log` regardless of which agent ran (its content shape varies — stream-json lines for claude, plain stdout for codex).

Config keys worth knowing: `defaultAgent` (`"claude"` | `"codex"`), `stallMinutes` (replaces the deprecated `claudeStallMinutes`, which is still read for backward compatibility — emits a warn log on load).

`server.json` is the daemon's liveness file — the CLI uses it to decide whether to spawn. Don't change its shape (`{pid, port, startedAt}`) without updating `cli/daemon-launcher.ts` in the same change.
