# Changelog

All notable changes to this project will be documented here.

Format roughly follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-04-28

First releasable version. v1 acceptance per spec §13: 9 ✅ / 2 ⚠️ / 0 ❌, QA verdict SHIP.

### Added — Documentation
- Design spec (`docs/superpowers/specs/2026-04-28-better-review-design.md`) — 13 sections covering goals, architecture, data model, flows, error handling, testing, acceptance criteria
- UX guidelines (`docs/design/ux-guidelines.md`) — IA, severity/status visual system, layout, edit mode, submit flow, sidebar density, prompt editor, color tokens, light/dark, a11y
- Implementation plan (`docs/superpowers/plans/2026-04-28-better-review.md`) — 25 phases, 59 tasks, 260 TDD steps
- v1 QA acceptance report (`docs/qa/2026-04-28-v1-acceptance.md`)
- User-facing README with install / usage / CLI reference / config / FAQ

### Added — Foundation
- Project bootstrap: package.json, tsconfig (server / cli / web / test), vitest, ESLint, Prettier
- Shared types and zod schema for `Finding` (`src/shared/`)
- Path helpers, config loader (zod defaults), file logger (`src/server/`)

### Added — Persistence
- SQLite layer: initial schema migration, version-tracked migration runner, WAL-mode connection
- Repositories for `pr_sessions`, `findings`, `submissions`

### Added — GitHub integration
- `gh` CLI wrapper with typed errors (`src/server/github/`)
- PR target parser (accepts `123`, `owner/repo#123`, GitHub URL)

### Added — Prompts
- Built-in review prompt template covering pr-review.md §1–8 categories (scope, correctness/type-safety, security, architecture, performance, naming, complexity, error handling), severity rubric, fixed category enum, and Chinese-language requirement for `title` / `body`
- Three-level resolver (project → global → built-in)
- Variable-substitution renderer (`{{PR_META}}`, `{{DIFF}}`, `{{FINDINGS_PATH}}`, `{{SCHEMA}}`)
- Per-scope prompt store with read/write/delete

### Added — Review engine
- Findings JSON parser with schema validation
- In-memory SSE event bus
- `claude` stream-json output parser
- Chokidar-based `findings.json` watcher
- Review runner with stall watchdog (kills on N minutes of no stream-json events)
- Concurrency queue (`maxConcurrentReviews`)
- Submit-flow utilities: diff-line validator + GitHub review payload builder

### Added — HTTP API (Hono)
- Origin-guard middleware
- Activity middleware that bumps the daemon idle timer on every HTTP request
- `GET /api/health` — claude/gh discovery and gh-auth status
- Sessions routes: list, create, detail (`{ session, findings }`), delete, rerun, **diff** (reads `<workdir>/diff.cache`)
- Findings routes: PATCH update, PATCH select, DELETE
- Prompts routes: GET effective + sources, PUT scope, DELETE scope
- SSE streams: per-session events and global events
- Submit orchestrator + route (gh API call, line-degradation handling, submission record)

### Added — Daemon
- Boot/wire dependencies, server.json (pid + port) management
- Idle-shutdown timer (configurable, default 4h), graceful shutdown, stale-daemon recovery
- Bundles compiled web assets via `scripts/copy-assets.mjs`; serves `dist/web` with SPA fallback

### Added — CLI
- Daemon launcher with health probe (spawns detached daemon, polls `/api/health`)
- Commander entry: `better-review [PR]`, `--stop`, `--status`, `--help`

### Added — Web UI
- Vite + React + Tailwind bootstrap
- API client + TanStack Query setup
- `useSSE` hook
- Health banner + app layout shell
- Sidebar with live session status
- Home page with new-PR input and recent sessions list
- DiffViewer with slice rendering (±10 lines) and expand controls
- FindingCard with pencil-icon edit and `⌘↵` save (no double-click, no blur-save)
- FindingList with per-file grouping and PR-wide section
- PR detail page (header, status badges, finding list)
- SubmitDrawer with 4 steps (Selection → Event → Preview → Confirm), preview of line-not-in-diff degradations in step 1, copy-to-clipboard for the GitHub payload
- Prompt editor with three scope tabs (effective / project / global), source indicator, save (`⌘S`), reset, "apply to current session" rerun modal
- Settings page exposing daemon info from `/api/health` and the on-disk config snippet

### Added — Testing
- 33 server test files / 106 cases covering DB repos, GH client, prompts, engine, API routes, submit, daemon lifecycle
- 9 web test files / 43 cases covering hooks, components, drawers, pages
- Playwright config + happy-path E2E (homepage rendering + API-driven session creation) using fake claude/gh shims under `tests/fixtures/`

### Notes
- Strict TDD: failing test → implement → green → commit. One task = one Conventional Commits commit.
- UX deviations from spec, all explicitly approved before implementation: edit via pencil + `e` (not double-click); explicit `⌘↵` save (not blur-save); single-column inline-diff layout; v1 edits restricted to severity / title / body / suggestion; light + dark mode following system; passive "submitted" header line.

### Known limitations carried into v1.0
- ⚠️ Streaming-progress panel during `running` is not implemented (the spec calls for it but the team intentionally deferred to v2; sidebar status badges still update via SSE).
- ⚠️ Per-PR working-directory GC after 7 days is not implemented; data accumulates in `~/.better-review/pr-*` until manually cleaned.
- The client-side `isLineInDiff` mirror in `src/web/lib/diff-line-check.ts` is a verbatim port of the server validator. If hunk parsing diverges in future, consolidate.
- `tests/server/engine/findings-watcher.test.ts` has a thin chokidar timing margin and can flake; reruns pass cleanly.
- E2E covers homepage + API session creation only; full select → submit flow lives in unit tests rather than the browser flow.
- No test for "pid dead but `server.json` still on disk" stale-daemon path; the recovery logic exists but is unverified.
- Keyboard shortcuts cover only `e`, `⌘↵`, `Esc` on FindingCard. UX guidelines §10 lists more (`j/k` navigation, `x` select, `/` focus, `Shift+S`, `?` help) — deferred.
- The original claude-emitted finding `id` is not persisted; on rerun, R-numbers are re-derived from `ord`.

[Unreleased]: https://example.com/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/releases/tag/v0.1.0
