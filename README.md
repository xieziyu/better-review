# better-review

> A local-first PR review helper. Drives `claude` or `codex` review agents under a browser UI, then ships findings to GitHub as inline comments via the `gh` CLI.

[简体中文](./README.zh-CN.md)

`better-review` runs entirely on your machine: a Node daemon, a React SPA, and a thin orchestration layer over the agent and `gh` CLIs. There is no cloud component, no auth layer, and no shared state — everything lives under `~/.better-review/`.

## Features

- **Browser triage** for findings: checkbox / edit / delete each one, with the relevant diff slice expanded inline.
- **Pluggable agents** — pick `claude` or `codex` per review, or set a default. The agent layer is a small interface; new providers drop into `src/server/engine/agent/`.
- **One-click submission** to GitHub: selected findings become inline comments, off-diff or PR-wide ones fall back to the review body, all via `gh api`.
- **Multi-PR concurrency** with a session sidebar that updates over SSE; the daemon caps parallel agent processes (configurable).
- **Three-tier prompt overrides** — project (`<selected-repo>/.better-review/review.md`) → global (`~/.better-review/review.md`) → built-in. First hit wins.
- **No magic state** — sessions, findings, and submissions sit in a local SQLite file you can inspect.

## Prerequisites

| Tool                               | Version                   | Notes                                                                                                                                 |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [Node.js](https://nodejs.org)      | ≥ 20                      | Required by the daemon and the build.                                                                                                 |
| [`gh` CLI](https://cli.github.com) | recent                    | Must be authenticated (`gh auth login`).                                                                                              |
| Review agent CLI                   | at least one              | [`claude`](https://docs.anthropic.com/en/docs/claude-code) and/or [`codex`](https://github.com/openai/codex). Must be on your `PATH`. |
| Browser                            | Chrome / Firefox / Safari | UI runs at `http://127.0.0.1:<port>`.                                                                                                 |

## Install

From source (until this is on npm):

```bash
git clone https://github.com/xieziyu/better-review.git
cd better-review
pnpm install
pnpm run build
npm install -g .         # or: pnpm link --global
```

Verify:

```bash
better-review --help
```

If you'd rather not install globally, run `node dist/cli/index.js …` after `pnpm run build` — every `better-review …` invocation in this README has the same form.

## Quick start

```bash
better-review                                       # launch daemon + open UI
better-review https://github.com/owner/repo/pull/1  # also create a review and jump to it
better-review status                                # pid / port / startedAt
better-review stop                                  # graceful shutdown
```

The first run creates `~/.better-review/` (override with `BETTER_REVIEW_HOME`).

## Usage

### Create a review

Paste a GitHub PR URL on the home page (only `https://github.com/<owner>/<repo>/pull/<n>` is accepted) and press **Start review**. The form has three optional inputs you can layer on top:

- **Local repo path** — point at your existing clone (e.g. `~/code/owner/repo`). The daemon adds a `git worktree` at the PR head so the agent sees PR-merged source, not just the diff. Auto-filled from history when the URL matches a previously-used path.
- **Extra context** — a per-review prompt addendum (spec snippets, design intent, etc.). Affects only this session; doesn't touch `review.md`.
- **Agent** — segmented selector to override `defaultAgent` for this session.

You can also pass the URL directly on the CLI — it opens the UI at that PR with default settings.

### Triage findings

Each finding renders as a card with:

- a checkbox controlling whether it ships,
- a severity tag (`MUST` / `SHOULD` / `NIT`),
- the body in markdown with an inline diff slice when the finding has `file:line`,
- edit and delete buttons (`⌘↵` saves; delete is local-only and doesn't touch GitHub).

PR-wide findings (no `file`) live in a separate group at the top. Open the same PR in another tab and edits sync over SSE.

### Submit to GitHub

The **Submit** drawer is two steps:

1. **Review** — preview which selected findings become inline comments and which fall back to the review body (off-diff or PR-wide), pick a review event (`COMMENT` / `REQUEST_CHANGES` / `APPROVE`), and edit the review body. The body is auto-populated from PR-wide findings unless you override it.
2. **Confirm** — final summary, then submit (`⌘⏎`). The daemon POSTs to `gh api repos/<owner>/<repo>/pulls/<n>/reviews` and shows the GitHub URL inline.

There are no automatic retries; failures surface in the banner and the submissions table.

### Customise the review prompt

The prompt is split into two layers:

- **Framework** (read-only, shipped with the package): reviewer persona, placeholder positions, the **severity rubric** (`must` / `should` / `nit` semantics), output schema, and `suggestion` anchoring rules. These are hard contracts for the findings parser and the submit pipeline — your `review.md` cannot override them.
- **Rules** (overridable): the review checklist, `category` label set, and any domain-specific guidance you want the agent to follow. Resolved in this order — first hit wins:

  ```
  <selected-repo>/.better-review/review.md   # project (the local repo pinned for the review)
  ~/.better-review/review.md                 # global
  prompts/builtin-rules.md                   # built-in default
  ```

  The project tier is keyed to the local repo you pin for a review — not the daemon's working directory. If a review runs without a pinned local repo, the project tier is skipped.

Edit either scope from the **Prompt** link in the top bar (`Project` / `Global` tabs; `⌘S` saves). The `Project` tab has a repo selector at the top — pick the local repo whose `.better-review/review.md` you want to edit. Saving only affects future reviews. To replay existing sessions with the new rules, use **Apply to current session** in the prompt editor (it opens a picker so you can select which sessions to rerun) or **Rerun** on a single PR detail page. Daemon configuration (default agent, watchdog timeout, GC retention, etc.) lives under the **Settings** link in the top bar; the **status dot** next to it shows daemon and CLI health at a glance — click for a popover with pid / port / uptime / agent + `gh` paths.

## Configuration

Layout under `~/.better-review/`:

```
config.json               # optional; defaults are fine
server.json               # daemon liveness: { pid, port, startedAt }
state.db                  # SQLite — sessions / findings / submissions
daemon.log                # structured server logs
review.md                 # global rule overrides (optional)
sessions/pr-<...>/        # per-review workdir: diff.cache, findings.json, agent.log, prompt.txt
```

`config.json` keys (all optional). The **Settings** page edits the same file; most keys hot-reload, the two flagged below need a daemon restart.

| Key                    | Default      | Meaning                                                                     |
| ---------------------- | ------------ | --------------------------------------------------------------------------- |
| `port`                 | `0` (random) | Set to a fixed port if you want a stable URL. _(restart required)_          |
| `maxConcurrentReviews` | `4`          | Cap on parallel agent processes; the rest queue. _(restart required)_       |
| `stallMinutes`         | `3`          | Watchdog kills an agent that emits no stdout for this long.                 |
| `defaultAgent`         | `"claude"`   | `"claude"` or `"codex"`; UI selector overrides per session.                 |
| `perPRGCDays`          | `7`          | Garbage-collect per-PR workdirs older than this many days; `0` disables GC. |

## Development

```bash
pnpm install
pnpm run dev:server    # tsx watch on the daemon
pnpm run dev:web       # Vite dev server, proxies /api → daemon
pnpm run build         # tsc + vite build + scripts/copy-assets.mjs
pnpm run test          # vitest (server + cli + shared)
pnpm run test:web      # vitest jsdom (web components)
pnpm run e2e           # Playwright happy path
pnpm run lint
pnpm run format        # writes; `format:check` for CI
```

### Guiding principles

- **Conventional Commits**, lowercase imperative — `feat(scope): …`, `fix(scope): …`. Match existing scopes (`cli`, `server`, `engine`, `web`, `prompts`).
- **TDD for routes and engine code**: failing test → implementation → commit.
- **No mocks for `better-sqlite3`, the agent CLIs, or `gh`.** Tests open a real SQLite file at a temp path, and shell shims under `tests/fixtures/` (`fake-claude.sh`, `fake-codex.sh`, `fake-gh.sh`) stand in for the external tools.
- **Strict TS** — `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Narrow indexed access; pass `undefined` explicitly for optional fields.
- **Don't add `.js` to TypeScript imports.** `scripts/copy-assets.mjs` rewrites compiled output post-build; sources stay extensionless.
- **Prompt convention** — when editing `prompts/builtin-rules.md` or override `review.md`, write prose in 简体中文 and keep code identifiers, paths, and flags in English.

For deeper architecture and design rationale, see [`CLAUDE.md`](./CLAUDE.md), [`DESIGN.md`](./DESIGN.md), and [`PRODUCT.md`](./PRODUCT.md).

## FAQ

**Port already in use?** Leave `port: 0` in `config.json` so the OS picks a free one, or set a stable port and stop whatever else is bound to it.

**Status dot turns red, popover shows `gh: not authed`.** The daemon inherits the env from the shell that started it. Run `gh auth login` and then `better-review restart`.

**Agent runs forever and nothing happens.** Default watchdog is 3 minutes of silent stdout; raise `stallMinutes` if your reviews legitimately go quiet for longer. After a kill, the session goes `failed` — click **Rerun**.

**I edited the prompt — does it re-run my open PRs?** No. Existing findings stay put; click **Rerun** on the PR detail page (or **Apply to current session** in the prompt editor) to re-execute with the current rules.

## License

MIT — see [LICENSE](./LICENSE).
