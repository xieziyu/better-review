# Changelog

All notable changes to this project will be documented here.

Format roughly follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

_(no unreleased changes)_

## [0.1.0] — 2026-05-16

The shipped 0.1.x line. Feature buckets are grouped by theme rather than by individual commit; see `git log` for fine-grained history. Highlights since the v0.1 initial cut:

### Added — Pluggable agents

- New `ReviewAgent` abstraction under `src/server/engine/agent/`; the runner spawns whichever agent the session pins (`getAgent(kind)`).
- `codex` agent: feeds the prompt via stdin (avoids argv length limits with large diffs), runs under `codex exec --sandbox workspace-write --skip-git-repo-check --color never -`.
- `pi` agent: parses `pi --mode json` events, surfaces assistant text + tool calls.
- `claude` agent retained as the original; `claude --output-format stream-json --verbose -p <prompt>`.
- New `defaultAgent` config key (`"codex"` / `"claude"` / `"pi"`); replaces hard-coded `claude`. When the value isn't explicit in `config.json` and the configured CLI is missing, the daemon auto-falls-back to the first installed agent in `AGENT_KINDS` order (codex → claude → pi).
- New `stallMinutes` config key applies to all agents; deprecated alias `claudeStallMinutes` still read with a warn log.
- Health endpoint returns per-agent presence (`agents.codex`, `agents.claude`, `agents.pi`) plus the resolved `defaultAgent`; UI banner only goes red when the *default* agent is missing.

### Added — Source context

- Sessions now pin an optional **local repo path** (`localRepoPath`). When set, the daemon creates a per-session `git worktree` at the PR head SHA so the agent reads coherent post-merge source instead of only the diff.
- Without a pinned clone, the daemon fetches a partial **snapshot** of diff-touched files via `gh api .../contents` at the PR head SHA. `SourceKind` = `'worktree' | 'snapshot' | 'none'`.
- New `prepareSourceContext` orchestrator, plus `git/worktree.ts` and `git/snapshot.ts`. The daemon also runs an idempotent `git worktree prune` sweep on boot to clean up orphan registry entries from prior crashes.
- Recent-repos heuristic on the home page: pasting a PR URL whose `owner/repo` matches a previously-used local clone auto-fills the field. Native folder picker exposed via `GET /api/fs/pick` where supported.

### Added — Rerun & prior-review feedback

- Every rerun **archives the previous round** (sessions repo flips status to `archived` + findings are flagged `archived=1`) and starts a fresh session for the same PR. The UI renders a `Round N` tag and read-only banner for historical rounds.
- `loadPriorReviewContext` fetches the prior submission's body, inline comments (with replies), and the PR conversation thread; `renderPrompt` injects them into the framework's `{{#PRIOR_REVIEW}}` block so the agent can build on past judgment.
- Force-pushed PRs are detected (last-reviewed SHA no longer in the PR commit graph) and called out explicitly in the prompt via `{{#FORCE_PUSHED}}` / `{{^FORCE_PUSHED}}` switches.
- `extractNewHunks` + `annotateDiffWithIncremental` add `[NEW SINCE LAST REVIEW]` markers on changed regions when prior context is available.
- New `POST /api/sessions/:id/cancel` route. `POST /api/sessions/:id/rerun` accepts `{ agent?, extraPrompt? }` so reruns can switch agent or override the carried-forward extra context.
- Per-review **extra prompt** (`extraPrompt`) — free-form per-session notes injected via the framework's `{{#EXTRA_NOTES}}` block. Persisted on the session; editable on the PR detail page; rerun carries it forward unless overridden (empty string clears).

### Added — Prep visibility

- New three-phase session lifecycle: `pending` (prep — gh fetches, prior-context lookups, source prep) → `running` (agent producing findings) → `ready`.
- `PrepLogger` writes JSONL `prep.log` per session containing `phase` markers and captured `gh` invocations (full stdout/stderr, exit code, duration). Replayed on refresh via `GET /api/sessions/:id/prep-log` (call-tail capped at 200).
- New `RunStrip` component: a one-line live status row between header and tab body. Modes: `prep` / `reviewing` / `review`, each with elapsed timer; auto-hides on terminal statuses.
- New `TranscriptDrawer` (replaces the earlier `Transcript` tab): bottom-anchored drawer toggled with `⌘J` / `Ctrl+J`, persisted open/closed + height. Shows `PrepPhasesPanel` (phase timeline + captured gh calls) above the live `TranscriptStream`.

### Added — Files-changed tab + manual findings

- New PR-detail tab strip `[Findings] [Files changed]`; defaults to Files changed.
- `FilesChangedView` renders a left FileTree + right FileDiffPane; finding cards inline into the diff at the matching hunk.
- `FileTree` is hierarchical and path-compressed (common-prefix directories collapse into one row), with finding counts + severity dots per row and a `Only with findings` filter.
- Manual findings: users can add their own finding directly from the Files tab via `AddFindingForm`. Stored alongside agent findings (`source: 'manual'`), submitted the same way.
- Toast notification when a streaming finding lands in a file the user isn't currently viewing — click to jump. `must` toasts persist.
- Rename-aware path resolution (`buildFileAliasMap` / `canonicalFilePath`) so renamed-file findings normalize to the diff's canonical display path.

### Added — Findings workspace refactor

- The Findings tab now hosts a responsive `FindingsWorkspace`: `[FindingList][FindingDetailPanel]` side-by-side at ≥1280px (resizable), or `FindingList + FindingDetailDrawer` at narrower widths.
- Code blocks in finding bodies are syntax-highlighted via Shiki (`@/lib/shiki` + `lang-from-file`).
- Diff slices in finding cards are trimmed to a window around the anchor line (±N lines) to keep cards readable.

### Added — Local export

- New `ExportPopover` on the PR detail toolbar (`⌘E` / `Ctrl+E`). Scope toggles Selected / All; format toggles Markdown / JSON; supports copy or file download (`findings-pr-<n>-<scope>.<ext>`). Pure client-side, doesn't touch GitHub.
- Shared renderer at `src/shared/export-renderer.ts` so server and CLI consumers could reuse the same Markdown / JSON shape later.

### Added — i18n (UI + prompts)

- React SPA fully localized with `react-i18next`; `en` + `zh-CN` dictionaries under `src/web/i18n/locales/`. Parity is enforced in `tests/web/i18n.test.tsx`. Top-bar `LanguageSwitcher` hot-applies.
- New `language` config key (`'en' | 'zh-CN'`), auto-detected on first run from `LC_ALL` / `LC_MESSAGES` / `LANG` / ICU.
- Built-in prompts are language-paired: `framework.{en,zh-CN}.md` + `builtin-rules.{en,zh-CN}.md`. `prompts/builtin.ts` selects by `config.language`; resolver threads the language through.

### Added — Settings + daemon ergonomics

- New Settings page edits `config.json` in-app (language, default agent, stall minutes, GC days, max concurrent reviews, port). Most keys hot-reload; `port` + `maxConcurrentReviews` are flagged as restart-required.
- Split DaemonStatus into its own popover anchored at the ActivityBar bottom (pid / port / uptime / agent + `gh` paths).
- `better-review restart` CLI subcommand (stops + spawns + re-opens UI).
- Dropped the 4h idle-shutdown timer; the daemon is now resident.
- `pr_sessions` schema gained `localRepoPath`, `sourceKind`, `sourceRefName`, `extraPrompt`, `headSha`, `error`; new `submission_comments` table tracks each posted GitHub comment for dedup and prior-context recovery.
- GC entry point (`gc.ts`) runs on daemon boot to remove per-PR workdirs older than `perPRGCDays`.

### Changed — Workbench UI rebuild

- Visual language reset around the four-column Workbench (ActivityBar / Sidebar / Main / Inspector-as-panel). Cool-slate (hue 240) neutrals, paired light + dark themes, severity expressed as `→ CAPS` text (color secondary), per `DESIGN.md`.
- Sidebar rebuilt: 28px `+ New review` header button, search input (`⌘K`), three status filter chips (Active / Done / Stale) — the only intentional rounded-full shape in the UI.
- ConfirmAction popups are portalled so they escape overflow clipping; they flip above the trigger when below would overflow.

### Changed — Prompt system split into framework + rules

- `prompts/builtin.md` split into `prompts/framework.md` (immutable) and `prompts/builtin-rules.md` (default rules). Framework owns the workflow contract (persona, placeholders, severity rubric, output format, `suggestion` semantics, source/extra-notes/prior-review blocks); rules own the review checklist categories and `category` labels.
- Three-level overrides (`<localRepoPath>/.better-review/review.md` → `~/.better-review/review.md` → builtin) apply to **rules only**. Framework cannot be overridden.
- New `{{RULES}}` placeholder injects user/builtin rules into the framework. Renderer substitutes `{{RULES}}` first, so legacy `review.md` files containing `{{DIFF}}` etc. still produce a runnable prompt (with duplicated diff/path text).
- `GET /api/prompts` response shape changed to `{ framework: { content }, rules: { effective, scopes } }`. Web Prompt Editor adds a read-only **Framework** tab; the **Project** scope is keyed to a local repo (selectable from a recent-repos picker) and the prompts API takes a `repo` path for that scope.
- `category` is a free-form string in the user-facing prompt (schema/DB already permit any string); custom rules can introduce new category labels without touching code.

### Changed — License

- Relicensed from MIT to **GPL-3.0-or-later**.

### Breaking

- `defaultAgent` default changed from `"claude"` to `"codex"` (with auto-fallback to whatever's installed when the value isn't explicit in `config.json`).
- Existing user-authored `~/.better-review/review.md` (or `<localRepoPath>/.better-review/review.md`) is interpreted as **rules**, not a full prompt. Files that contained `{{DIFF}}` / `{{PR_META}}` / `{{FINDINGS_PATH}}` / `{{SCHEMA}}` keep working but produce duplicated content; users should remove those placeholders and keep only their review checklist content.
- `pr_sessions` schema gained several non-null-defaulted columns plus a new `submission_comments` table — migrations apply transparently.

## [0.1.0-alpha] — 2026-04-28

First releasable cut. v1 acceptance per spec §13: 9 ✅ / 2 ⚠️ / 0 ❌, QA verdict SHIP.

### Added — Documentation

- Design spec (`docs/superpowers/specs/2026-04-28-better-review-design.md`) — 13 sections covering goals, architecture, data model, flows, error handling, testing, acceptance criteria
- UX guidelines (`docs/design/ux-guidelines.md`) — IA, severity/status visual system, layout, edit mode, submit flow, sidebar density, prompt editor, color tokens, light/dark, a11y
- Implementation plan (`docs/superpowers/plans/2026-04-28-better-review.md`) — 25 phases, 59 tasks, 260 TDD steps
- v1 QA acceptance report (`docs/qa/2026-04-28-v1-acceptance.md`)
- User-facing README with install / usage / CLI reference / config / FAQ

### Added — Foundation

- Project bootstrap: package.json, tsconfig (server / cli / web / test), vitest, oxlint, oxfmt
- Shared types and zod schema for `Finding` (`src/shared/`)
- Path helpers, config loader (zod defaults), file logger (`src/server/`)

### Added — Persistence

- SQLite layer: initial schema migration, version-tracked migration runner, WAL-mode connection
- Repositories for `pr_sessions`, `findings`, `submissions`

### Added — GitHub integration

- `gh` CLI wrapper with typed errors (`src/server/github/`)
- PR target parser

### Added — Prompts

- Built-in review prompt template covering scope, correctness/type-safety, security, architecture, performance, naming, complexity, error handling; severity rubric; output schema
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
- Sessions routes: list, create, detail, delete, rerun, diff
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
- Commander entry: `better-review [PR]`, `stop`, `status`

### Added — Web UI

- Vite + React + Tailwind bootstrap
- API client + TanStack Query setup
- `useSSE` hook
- Health banner + app layout shell
- Sidebar with live session status
- Home page with new-PR input and recent sessions list
- DiffViewer with slice rendering (±10 lines) and expand controls
- FindingCard with pencil-icon edit and `⌘↵` save
- FindingList with per-file grouping and PR-wide section
- PR detail page (header, status badges, finding list)
- SubmitDrawer with multi-step flow (Selection → Event → Preview → Confirm), preview of line-not-in-diff degradations, copy-to-clipboard for the GitHub payload
- Prompt editor with three scope tabs (effective / project / global), source indicator, save (`⌘S`), reset, "apply to current session" rerun modal
- Settings page exposing daemon info from `/api/health` and the on-disk config snippet

### Added — Testing

- Server tests covering DB repos, GH client, prompts, engine, API routes, submit, daemon lifecycle
- Web tests covering hooks, components, drawers, pages
- Playwright config + happy-path E2E (homepage rendering + API-driven session creation) using fake claude/gh shims under `tests/fixtures/`

### Notes

- Strict TDD: failing test → implement → green → commit. One task = one Conventional Commits commit.
- UX deviations from spec, all explicitly approved before implementation: edit via pencil + `e` (not double-click); explicit `⌘↵` save (not blur-save); single-column inline-diff layout; v1 edits restricted to severity / title / body / suggestion; light + dark mode following system; passive "submitted" header line.

[Unreleased]: https://github.com/xieziyu/better-review/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/xieziyu/better-review/releases/tag/v0.1.0
[0.1.0-alpha]: https://github.com/xieziyu/better-review/releases/tag/v0.1.0-alpha
