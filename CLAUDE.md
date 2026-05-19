# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Orientation

`better-review` is a **local PR-review tool**: a Node daemon + React SPA that drives one of several review-agent CLIs (currently `codex`, `claude`, and `pi`) plus the `gh` CLI. The agent layer is pluggable — see `src/server/engine/agent/`. Distributed as an npm bin (`better-review`) that launches a detached daemon, opens a browser UI, and shells out to those CLIs for actual work. There is no cloud component, no auth layer, and no multi-user state — everything lives under `~/.better-review/`.

User-facing docs live in `README.md` (English) and `README.zh-CN.md` (Chinese). Read them for end-to-end semantics (PR input formats, submit flow, prompt overrides, config keys, rerun/round semantics). The notes below are about _building and changing_ the code, not using it.

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
- `scripts/copy-assets.mjs` runs after `tsc` and does four things:
  1. Copies `src/server/db/migrations/*.sql` into `dist/server/db/migrations/`.
  2. Copies the language-paired prompt assets (`prompts/framework.{en,zh-CN}.md` + `prompts/builtin-rules.{en,zh-CN}.md`) to `dist/prompts/`.
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

Source: `src/server/start-session.ts` plus `src/server/engine/` and `src/server/git/`. Sessions transition through `pending` (prep in progress) → `running` (agent producing findings) → `ready` (awaiting human submit) → `submitted` / `failed` / `cancelled` / `archived` (set by rerun).

1. **Resolve PR target** — `github/pr-target-parser.ts` accepts only the canonical HTTPS GitHub PR URL (`https://github.com/<owner>/<repo>/pull/<n>`) and throws on anything else.
2. **Insert pending row + queue prep** — the session row is inserted with minimal fields immediately so the UI can navigate to its detail page; the rest of prep runs inside `queue.run(id, …)`. A `PrepLogger` (`engine/prep-logger.ts`) writes each phase + every captured `gh` call (full stdout / stderr / exit / duration) as JSONL to `<workdir>/prep.log`, and emits matching `progress` (`prep:*`) + `prep-output` SSE events. Phases are listed in `PREP_PHASES`.
3. **Fetch metadata + diff** — `gh pr view --json` and `gh pr diff` via `github/gh-client.ts` (always `execa`, never raw `child_process`). Diff is cached at `<workdir>/diff.cache`. Metadata back-fills the session row so the UI updates as soon as title/author/url/headSha are known.
4. **Prior review context + source prep** in parallel —
   - `engine/rerun-context.ts` fans out gh-api calls to load the prior submission's body + inline comments + replies + PR conversation thread (force-push detection by checking whether `lastReviewedSha` is still in the commit graph).
   - `git/source-prep.ts` picks a strategy: `worktree` (when `localRepoPath` is pinned — `git/worktree.ts` creates `<workdir>/source/` as a worktree at the PR head SHA), otherwise `snapshot` (`git/snapshot.ts` uses `gh api .../contents` to materialize just the diff-touched files), otherwise `none`. The orchestrator falls back to `none` on failure rather than aborting.
5. **Resolve + render prompt** — `prompts/resolver.ts` walks: project (`<localRepoPath>/.better-review/review.md`) → global (`~/.better-review/review.md`) → builtin (`prompts/builtin-rules.<lang>.md`). First hit wins; no merging. The project tier resolves against the session's selected local repo (`localRepoPath`), **not** the daemon's cwd; when no local repo is pinned the project tier is skipped. The framework template (`prompts/framework.<lang>.md`, picked by `getFramework(lang)` in `prompts/builtin.ts`) wraps the rules via `{{RULES}}`. `prompts/renderer.ts` substitutes `{{PR_META}}`, `{{DIFF}}`, `{{FINDINGS_PATH}}`, `{{SCHEMA}}`, `{{SOURCE_KIND}}`, `{{SOURCE_PATH}}`, `{{HEAD_SHA}}`, and conditionally expands three block sections: `{{#SOURCE:worktree|snapshot|none}}…{{/SOURCE}}` (active kind survives, others are stripped), `{{#EXTRA_NOTES}}…{{/EXTRA_NOTES}}` (kept only when `extraPrompt` is non-empty), `{{#PRIOR_REVIEW}}…{{/PRIOR_REVIEW}}` with nested `{{#FORCE_PUSHED}}` / `{{^FORCE_PUSHED}}` switches (kept only when prior context loaded). On rerun with prior context, `extractNewHunks` + `annotateDiffWithIncremental` add `[NEW SINCE LAST REVIEW]` markers to the diff. The framework wording is agent-neutral — it tells the agent to "write a JSON array of findings to {{FINDINGS_PATH}} using whatever file-write capability your runtime provides," not "use the Write tool."
6. **Pick agent + resolve executable** — the session's `agent` field (default `config.defaultAgent`) selects a `ReviewAgent` from `engine/agent/` (`getAgent(kind)`); `agentPaths` is cached at boot via `findExecutable()`. `pickEffectiveDefaultAgent` auto-falls-back to the first installed agent in `AGENT_KINDS` order (codex → claude → pi) when the configured default is missing AND the user never wrote `defaultAgent` to `config.json`. Sessions that pin a missing CLI fail synchronously to the caller — no pending row that will instantly fail.
7. **Spawn agent** — `engine/runner.ts` calls `agent.spawn({ executable, prompt, workdir, sourcePath?, logPath, onProgress, onOutput })` under a `ConcurrencyQueue` (config `maxConcurrentReviews`, default 4). The runner registers the handle in `RunnerRegistry` so `cancel-session.ts` can kill it. Each `onProgress` tick resets the watchdog; if no tick arrives for `stallMinutes`, the runner SIGTERMs (then SIGKILLs) the child. Implementations:
   - `agent/codex.ts` — `codex exec --sandbox workspace-write --skip-git-repo-check --color never -`; prompt fed via stdin (avoids argv length limits with large diffs); ticks once per stdout line. When `sourcePath` is set, exposes the source tree via `--add-dir` while keeping `cwd=workdir` so apply_patch lets the agent write `findings.json` (see comments in `agent/codex.ts` for the two-boundary explanation).
   - `agent/claude.ts` — `claude --output-format stream-json --verbose -p <prompt>`; ticks once per stream-json event via `engine/stream-json.ts`.
   - `agent/pi.ts` — `pi --mode json …`; ticks once per JSON event; `formatPiEvent` converts events to human-readable transcript lines (assistant text, tool calls, final result).
8. **Parse findings** — `engine/findings-watcher.ts` uses `chokidar` on `<workdir>/findings.json`. `engine/findings-parser.ts` validates entries against the zod schema in `src/shared/findings-schema.ts` and dedupes by `(file, line, title)`. New rows go through `db/findings.ts` and get broadcast on the SSE bus.
9. **Submit** — `engine/payload-builder.ts` separates inline-eligible findings from PR-wide / off-diff ones (validated by `engine/diff-line-validator.ts`); `engine/submit-dedup.ts` skips findings whose `(file, line, title)` we already posted in a prior submission (using `db/submission-comments.ts`); `engine/submit.ts` POSTs the payload via `gh api repos/.../pulls/<n>/reviews`. No retries. Successful submissions also write a row per posted GitHub comment into `submission_comments` for future dedup + prior-context recovery.
10. **Rerun** — `rerun-session.ts` archives the previous session (status → `archived`, all its findings → `archived=1`) and calls `startSession` with the same PR target plus the previous `extraPrompt` (unless overridden). The fresh session gets a new id and goes through the full prep pipeline; the round number is derived in the UI by counting prior archived sessions for the same PR.
11. **GC** — `gc.ts` runs on daemon boot and removes per-PR workdirs older than `perPRGCDays`. An idempotent `git worktree prune` sweep runs in parallel to clean up orphan registry entries from prior crashes.

### Module map

```
src/
  cli/            commander entrypoint + daemon health-probe / detached spawn
  shared/         zod schemas + cross-cutting types (used by web AND server)
                  export-renderer.ts, findings-{schema,sort}.ts, types.ts
  server/
    index.ts          startDaemon(): wires deps, opens Hono; daemon is resident (no idle shutdown)
    start-session.ts  factory that closes over deps and returns startSession()
    rerun-session.ts  archives prior session + dispatches a fresh startSession
    cancel-session.ts SIGTERM/SIGKILL the runner for a given session id
    delete-session.ts removes DB rows + session workdir + worktree (if any)
    gc.ts             boot-time garbage collection of stale per-PR workdirs
    paths.ts          ~/.better-review path resolution; honors BETTER_REVIEW_HOME
    config.ts         loads/validates config.json (zod); detectSystemLanguage()
    api/
      app.ts            Hono app + middleware composition
      routes/           sessions, findings, submit, prompts, events (SSE), health,
                        config, fs (folder picker), recent-repos
      middleware/       origin guard (rejects non-localhost)
    engine/           agent lifecycle, findings ingestion, submit payload
      agent/          ReviewAgent abstraction + codex / claude / pi implementations
      prep-logger.ts  per-session JSONL prep.log writer + AsyncLocalStorage phase tag
      runner.ts       spawns agent under queue, owns watchdog
      runner-registry.ts  session-id → handle map (for cancel-session)
      rerun-context.ts    loads prior submission body + inline comments + replies + PR thread
      diff-{annotator,incremental,line-validator}.ts
      payload-builder.ts  splits findings into inline / body
      submit-dedup.ts     skip findings already posted as comments
      submit.ts           posts the review via gh api
      findings-{parser,watcher}.ts
      stream-json.ts      shared claude stream-json line iterator
      queue.ts            concurrency-limit FIFO
      events.ts           in-memory SSE bus
    github/           gh CLI wrapper, PR-target parser, typed error normalisation
                      gh-client.ts also provides withGhCallRecorder for prep capture
    git/              source-prep.ts orchestrator + worktree.ts + snapshot.ts
    fs/               folder-picker.ts (native chooser when available)
    db/               better-sqlite3; migrations in db/migrations/*.sql
                      sessions, findings, submissions, submission_comments
    prompts/          three-tier resolver, mustache-style renderer with conditional blocks,
                      language-paired builtin loader, per-scope file store
  web/              React + Vite SPA
    pages/            Home, PRDetail, PromptEditor, Settings
    components/       ActivityBar, Sidebar, RunStrip, FindingsWorkspace, FindingList,
                      FindingRow, FindingDetailPanel/Drawer, TranscriptDrawer,
                      TranscriptStream, PrepPhasesPanel, SubmitDrawer, ExportPopover,
                      DaemonStatus, AgentList, LanguageSwitcher, ThemeToggle,
                      DiffViewer, CodeBlock, files-changed/* (FileTree, FileDiffPane,
                      InlineFindingCard, AddFindingForm), ui/* primitives
    lib/              api client, queryClient, sse, selection context, toast,
                      diff-utils + diff-line-check, file-tree, shiki helpers,
                      use-resizable, theme, lang-from-file, export-clipboard
    i18n/             react-i18next setup + en/zh-CN dictionaries
```

The daemon depends on these shell tools at runtime: at least one review agent CLI (`codex`, `claude`, and/or `pi`, resolved once at startup via `which`), `gh`, and `node` itself. The `/api/health` endpoint reports presence per agent under `agents.<kind>` and the configured `defaultAgent` — UI banner only fires red when the **default** agent is missing; non-default agents that are missing show as disabled in the Home selector.

## Conventions

### Tests

- **Don't mock `better-sqlite3`.** Every server test opens a real DB at a temp path. The migrations module is the source of truth for schema; tests run it on init.
- **Don't mock agent CLIs or `gh`.** Use the existing shims at `tests/fixtures/fake-codex.sh`, `tests/fixtures/fake-claude.sh`, and `tests/fixtures/fake-gh.sh` — they emit deterministic line-oriented / stream-json / JSON output and are exercised end-to-end. The runner test parameterizes over the agents via `describe.each`. Add new fixture behaviour to those scripts rather than introducing in-process mocks.
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
config.json    state.db    daemon.log    daemon-stderr.log    server.json
review.md                                                     (global prompt)
codex-home/      (isolated CODEX_HOME — see "codex trust isolation" below)
sessions/pr-<owner>-<repo>-<n>-<short>/
  diff.cache       (raw unified diff fetched by `gh pr diff`)
  findings.json    (the agent writes here; watched by chokidar)
  agent.log        (raw agent stdout — line-oriented for codex, stream-json for claude, JSON for pi)
  prompt.txt       (the full rendered prompt sent to the agent)
  prep.log         (JSONL: `phase` markers + captured `gh` calls during prep)
  source/          (per-session git worktree at PR head — only when localRepoPath is pinned)
  snapshot/        (per-session partial files snapshot — only when no localRepoPath)
```

The session log is named `agent.log` regardless of which agent ran (its content shape varies).

#### codex trust isolation

The codex CLI appends a `[projects."<cwd>"] trust_level = "trusted"` block to its `config.toml` every time it runs in a new directory. Because we use a fresh per-session workdir, this would grow the user's real `~/.codex/config.toml` by one block per review (upstream issues openai/codex#14601, #15433). To avoid that, the daemon spawns codex with `CODEX_HOME` pointing at `~/.better-review/codex-home/`. The bootstrap (`src/server/engine/agent/codex-home.ts`) is idempotent and runs just before each codex spawn:

- Seeds `codex-home/config.toml` from the user's real `~/.codex/config.toml`, stripped of `[projects.*]` sections. Resyncs only when the user's file mtime changes, so codex's own trust writes inside `codex-home/` are preserved across spawns.
- Symlinks `codex-home/auth.json` to the user's real `~/.codex/auth.json` when file-based credentials are present. macOS keychain users skip this branch and inherit credentials via the shared keyring.

If the user edits their `~/.codex/config.toml`, the change rolls into `codex-home/config.toml` on the next codex spawn — no daemon restart required.

Config keys worth knowing: `defaultAgent` (`"codex"` | `"claude"` | `"pi"`, default `"codex"`; auto-falls-back to first installed when not explicit in `config.json`), `stallMinutes` (replaces the deprecated `claudeStallMinutes`, which is still read for backward compatibility — emits a warn log on load), `language` (`"en" | "zh-CN"`, auto-detected from `LC_ALL` / `LANG` / ICU on first boot).

`server.json` is the daemon's liveness file — the CLI uses it to decide whether to spawn. Don't change its shape (`{pid, port, startedAt}`) without updating `cli/daemon-launcher.ts` in the same change.

### Scratch / mockup output

When you generate HTML mockups, draft files, or other throwaway artifacts during a task, write them into `./tmp/` at the repo root — **do not** create a new sibling directory or switch your cwd elsewhere. `./tmp/` is already in `.gitignore`, so files there are safe and easy to clean up. Reuse the same path across iterations (e.g. `./tmp/files-changed-v3.html`) rather than spawning new locations.
