# better-review · UX Guidelines

**Date**: 2026-04-28
**Status**: Authoritative for v1 frontend implementation
**Audience**: frontend-dev (and anyone reviewing UI changes)

This document is opinionated. Where the spec leaves room, this picks one option and explains why. If you disagree, push back before deviating — don't silently re-decide during implementation.

---

## 0. Design principles

These guide every micro-decision below. When in doubt, optimize in this order:

1. **Scanability over density.** A reviewer triages 8–20 findings in one sitting. The page should reveal severity, file, and verdict in <1s of glance.
2. **Edit ergonomics.** Editing a finding should feel like editing a doc, not filling out a form. Inline > modal. Markdown > rich-text.
3. **Local-first calm.** This is a single-user local tool. No spinners-as-decoration, no toast notifications for routine success, no confirmation-modal-fatigue.
4. **Streaming honesty.** Show real progress (tool calls, finding count climbing) — not a fake progress bar.
5. **Severity is information, not alarm.** Bold borders and icons, restrained fills. The page should not look like an outage dashboard.

---

## 1. Information architecture

### 1.1 Routes

| Route       | Purpose                                                    | Sidebar visible? |
| ----------- | ---------------------------------------------------------- | ---------------- |
| `/`         | Welcome / new-PR entry / recent sessions list              | Yes              |
| `/pr/:id`   | The main work surface: findings + diff + submit            | Yes              |
| `/prompt`   | Prompt template editor (3 scopes)                          | Yes              |
| `/settings` | Preferences (idle timeout, default event, stall threshold) | Yes              |

The sidebar is **persistent on every route**. There is no "focus mode" toggle in v1 — collapsing the sidebar is a future-only concern. Rationale: the user is here to triage _across_ PRs; the sidebar is the primary navigation aid and a live status board. Hiding it would defeat the multi-PR core feature.

### 1.2 Top bar

A 48px-tall top bar sits above both sidebar and main:

```
┌──────────────────────────────────────────────────────────────────────┐
│ better-review                       [HealthBanner zone]    Prompt  ⚙ │
└──────────────────────────────────────────────────────────────────────┘
```

- **Left**: app title (clickable, routes to `/`). No logo image in v1 — typeset wordmark only (`font-mono` or `font-semibold tracking-tight`).
- **Center**: `<HealthBanner>` zone. Zero-height when healthy. When `claude` / `gh` missing or `gh auth` failed, expands to an amber/red banner with action text (e.g. _"`gh auth login` required — copy command"_).
- **Right**: text links to `Prompt` and `Settings` (gear icon). No avatar, no user menu.

### 1.3 Empty / loading / error states

Every route must define each. Defaults below; deviate only with reason.

#### `/` — Home

- **First-time empty**: Hero with one-line tagline ("Review GitHub PRs with claude — locally"), centered input `Enter PR (#123, owner/repo#123, or URL)` and a single primary button **Start review**. Secondary text links: _"How it works"_ (collapses an inline FAQ) and _"Edit prompt"_ (→ `/prompt`).
- **With history**: Same hero, condensed; below it a 3-column grid of _Recent sessions_ cards (max 12, "View all" → list view if implemented later). Each card: PR title, repo · #num, status badge, finding count, last activity.

#### `/pr/:id`

- **Loading session metadata**: Skeleton header (gray bars) + skeleton finding cards (3). No spinner.
- **`status=running`**: Header status badge animates (pulsing dot). Body shows a _streaming progress panel_: a vertical list of stream-json events (`tool_use: read file X`, `tool_use: write findings.json`, finding-added events), most recent on top, max 50 visible. As findings start landing, they replace the panel inline (panel collapses to a "View live log" disclosure).
- **`status=ready` with 0 findings**: Empty state inside main column — _"No issues found. Either the PR is clean, or the prompt missed something."_ with two actions: **Rerun** and **Edit prompt**.
- **`status=failed`**: Red-bordered card with summarized error (top line of `error` field), a `<details>` to expand the last 50 lines of `claude.log`, and **Retry**. Don't auto-retry.
- **Diff fetch failed**: Inline placeholder where diff would render: _"Couldn't load diff. `gh pr diff` exited non-zero."_ + Retry.

#### `/prompt`

- **Empty (no overrides)**: Both _Project_ and _Global_ tabs show a textarea pre-filled with the builtin contents (read-only by default) and a button **Override at this scope**, which converts to editable.
- **Save error**: Inline red text under the editor.

#### `/settings`

- Form with sensible defaults pre-populated. No empty state needed.

### 1.4 Loading states (general)

- Use **skeleton blocks** for layout-known content (sidebar items, finding cards, header).
- Use a **subtle top progress bar** (2px, primary color, indeterminate) for in-flight mutations (PATCH finding, submit).
- Reserve spinners only for places where layout is truly unknown.

### 1.5 Error states (general)

- Network / 5xx: top-bar slim red band _"Connection to daemon lost — retrying…"_ with auto-reconnect.
- 4xx from daemon: inline near the action that triggered it. Never a global toast.
- `gh auth status` fails _during_ submit: open the SubmitDrawer's confirm step in an error state with copyable `gh auth login` and a Retry button.

---

## 2. Severity & status visual system

### 2.1 Severity tokens (Tailwind v3)

Three levels. The icon and border carry the signal; backgrounds stay quiet.

| Level    | Icon              | Light border         | Light bg        | Light text         | Dark border          | Dark bg             | Dark text          |
| -------- | ----------------- | -------------------- | --------------- | ------------------ | -------------------- | ------------------- | ------------------ |
| `must`   | filled circle (●) | `border-red-600`     | `bg-red-50`     | `text-red-700`     | `border-red-500`     | `bg-red-950/40`     | `text-red-300`     |
| `should` | half circle (◐)   | `border-amber-500`   | `bg-amber-50`   | `text-amber-700`   | `border-amber-400`   | `bg-amber-950/40`   | `text-amber-300`   |
| `nit`    | empty circle (○)  | `border-emerald-600` | `bg-emerald-50` | `text-emerald-700` | `border-emerald-500` | `bg-emerald-950/40` | `text-emerald-300` |

Why these exact tokens:

- Red-600 / amber-500 / emerald-600 each pass WCAG AA (4.5:1) on `white` for the text variants, and pass on `gray-950` for the dark-mode light-text variants. Verified against Tailwind's published palette.
- Background tints use the `-50` (light) / `-950/40` (dark) levels — present but not loud. The card body stays mostly neutral.
- `emerald` (not `green`) keeps the nit tone slightly bluer, distinguishing it from the GitHub "merged" green so the page doesn't read as a status board.

**FindingCard severity treatment**: a 3px solid left border in the severity color, plus the icon next to the severity label in the card header. No full-card background tint — only a 6px-wide `bg-{color}-50` strip behind the left border. The body remains `bg-white` / `bg-gray-950`.

**Severity selector** (in edit mode): a 3-segment toggle (radio-button group), pill-shaped, each segment shows icon + label, active segment uses the severity's border + bg combo, inactive segments are neutral with hover `bg-gray-100` / `bg-gray-800`.

### 2.2 Session status tokens

Five statuses. Each gets icon + color + label. Colors deliberately use a _different hue palette_ than severity so a glance never confuses them.

| Status      | Icon                                                | Color (light)                    | Color (dark)                         | Sidebar badge style | Live?       |
| ----------- | --------------------------------------------------- | -------------------------------- | ------------------------------------ | ------------------- | ----------- |
| `running`   | spinning dash (`Loader2` from lucide, animate-spin) | `text-blue-600 bg-blue-50`       | `text-blue-300 bg-blue-950/40`       | pulsing dot prefix  | yes — pulse |
| `ready`     | check (`Check`)                                     | `text-emerald-600 bg-emerald-50` | `text-emerald-300 bg-emerald-950/40` | static              | no          |
| `failed`    | alert-triangle (`AlertTriangle`)                    | `text-red-600 bg-red-50`         | `text-red-300 bg-red-950/40`         | static              | no          |
| `submitted` | upload-check (`CheckCheck`)                         | `text-violet-600 bg-violet-50`   | `text-violet-300 bg-violet-950/40`   | static              | no          |
| `archived`  | archive (`Archive`)                                 | `text-gray-500 bg-gray-100`      | `text-gray-400 bg-gray-800`          | static, dimmed      | no          |

Sidebar badge format: 12px circular icon + status word at `text-xs`, OR (denser) just the icon as a 14px chip — see §6 for which density to default to.

### 2.3 Edited indicator

When `finding.edited === 1`, show a small _pencil_ icon (`Pencil` from lucide, 12px) in the card header next to the title, color `text-gray-500`, with a `title="Edited"` tooltip. No color change, no background — purely informational.

---

## 3. PR detail page layout

This is the most important page. Two reasonable layouts exist; below I lay them out, then **recommend single-column inline-diff** and explain why.

### 3.1 Option A — Two-column (FindingList | DiffViewer)

```
┌──── Sidebar ───┬──────────────────────────── /pr/abc123 ───────────────────────────────┐
│ ● running      │ Header: PR title · repo#num · author · [status]      [Rerun] [Submit] │
│ ✓ ready    *3* │                                                                       │
│ ✓ ready        │ ┌──── FindingList ────────────┐ ┌──── DiffViewer ─────────────────┐   │
│ ! failed       │ │ src/auth/jwt.ts             │ │   src/auth/jwt.ts                │   │
│ + New PR       │ │ ┌─ R1 ●must ──────────────┐ │ │     12  function verifyJWT(t) { │   │
│                │ │ │ Don't trust unsigned... │ │ │     13    const decoded = jwt.de│   │
│                │ │ │ src/auth/jwt.ts:42      │ │ │  >  14    return decoded;       │◀──┤
│                │ │ │ [✓ select]              │ │ │     15  }                       │   │
│                │ │ └─────────────────────────┘ │ │                                  │   │
│                │ │ ┌─ R2 ◐should ────────────┐ │ │   src/auth/jwt.ts (different    │   │
│                │ │ │ Variable shadows...     │ │ │   slice; scrolls when R2 sel.)  │   │
│                │ │ │ src/auth/jwt.ts:88      │ │ │                                  │   │
│                │ │ └─────────────────────────┘ │ │                                  │   │
│                │ │ ...                         │ │                                  │   │
│                │ └─────────────────────────────┘ └──────────────────────────────────┘   │
└────────────────┴───────────────────────────────────────────────────────────────────────┘
```

Pros: less vertical scrolling; finding stays in view while reading the slice; familiar (GitHub split view).
Cons: each finding's diff is _not_ visible at the same time as another finding's; reading 8–20 findings means 8–20 click-to-load-slice cycles; multi-file scrolling is awkward (do you sync scroll? jump?); editing a finding loses the diff focus.

### 3.2 Option B — Single column with inline diff slice (RECOMMENDED)

````
┌──── Sidebar ───┬──────────────────────────── /pr/abc123 ───────────────────────────────┐
│ ● running      │ Header: PR title · repo#num · author · [status]      [Rerun] [Submit] │
│ ✓ ready    *3* │                                                                       │
│ + New PR       │ ┌────── src/auth/jwt.ts (3 findings) ─────────────────────────────┐   │
│                │ │ ┌─ R1 ●must · Type Safety ······ src/auth/jwt.ts:42 · GitHub ↗ ┐│   │
│                │ │ │ ☑  Don't trust unsigned JWT                              ✏ ▾ ││   │
│                │ │ │                                                              ││   │
│                │ │ │ The verifyJWT helper accepts a token and decodes without...  ││   │
│                │ │ │                                                              ││   │
│                │ │ │   40   import jwt from 'jsonwebtoken';                       ││   │
│                │ │ │   41                                                         ││   │
│                │ │ │ ▶ 42   const decoded = jwt.decode(token);  ←── slice ±10 lns││   │
│                │ │ │   43   return decoded;                                       ││   │
│                │ │ │   44 }                                                       ││   │
│                │ │ │   [Expand full hunk]                                          ││   │
│                │ │ │                                                              ││   │
│                │ │ │ Suggestion:                                                  ││   │
│                │ │ │ ```ts                                                        ││   │
│                │ │ │ const decoded = jwt.verify(token, secret);                   ││   │
│                │ │ │ ```                                                          ││   │
│                │ │ └──────────────────────────────────────────────────────────────┘│   │
│                │ │ ┌─ R2 ◐should · Naming ········ src/auth/jwt.ts:88 ───────────┐│   │
│                │ │ │ ☑  Variable shadows outer scope                              ││   │
│                │ │ │ ...                                                          ││   │
│                │ │ └──────────────────────────────────────────────────────────────┘│   │
│                │ └──────────────────────────────────────────────────────────────────┘   │
│                │ ┌────── src/auth/middleware.ts (2 findings) ──────────────────────┐   │
│                │ │ ┌─ R3 ◐should · Performance · src/auth/middleware.ts:12 ──────┐│   │
│                │ │ │ ...                                                          ││   │
│                │ │ └──────────────────────────────────────────────────────────────┘│   │
│                │ └──────────────────────────────────────────────────────────────────┘   │
│                │                                                                       │
│                │ ┌────── PR-wide (file=null, 1 finding) ───────────────────────────┐   │
│                │ │ ┌─ R6 ◐should · Architecture · (whole PR) ────────────────────┐│   │
│                │ │ │ ☑  Consider extracting auth concerns into a shared module    ││   │
│                │ │ └──────────────────────────────────────────────────────────────┘│   │
│                │ └──────────────────────────────────────────────────────────────────┘   │
└────────────────┴───────────────────────────────────────────────────────────────────────┘
````

Pros:

- **Scanability of 8–20 findings**: file groups become visual chapters; severity icons at the left edge let you skim verdicts in a single column scan.
- **Reading flow**: finding text and its code slice are adjacent; no eye-saccade between two columns.
- **Edit ergonomics**: expanding the markdown editor doesn't blow up the diff column; edit-in-place feels natural in a single column.
- **Multi-file**: no scroll-sync question. Each finding has its own slice; collapsed code mode (next bullet) keeps page length manageable.
- **PR-wide findings** (file=null) get a clean dedicated section at the bottom — a two-column layout has nowhere clean to put these.

Cons (and mitigations):

- Page can grow long with many findings × ±10 line slices. Mitigation: each FindingCard's diff slice has a collapsed default of just the highlighted line ±3, with **Expand** to ±10, **Expand full hunk** below that. Group headers (per file) are sticky.
- Less "GitHub-like". That's fine — we're not GitHub; we're optimizing for triage speed.

**Recommendation: Option B**. The reading flow alignment with the user's actual task (triage→edit→select) outweighs the small "I want to see all findings + all code at once" benefit of split view.

### 3.3 PR detail header

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◐ feat(auth): add JWT refresh token support                                  │
│ owner/repo#123 · @author · ↗ open on GitHub                                  │
│                                                                              │
│ [● running 2:14 elapsed]   [Rerun ↻]  [Prompt snapshot 👁]  [Submit (3) →]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Title row: PR title prominent (`text-lg font-semibold`), no severity icon (severity is a finding concept, not PR concept). Author/repo/url metadata one line below at `text-sm text-gray-500`.
- Status badge with elapsed timer when running; static "ready · 12 findings" when ready; "submitted · 2x" when submitted (and clicking opens the latest submission's GitHub URL).
- Actions, right-aligned:
  - **Rerun ↻**: secondary button. Confirmation popover only if `status=running` (would cancel current run).
  - **Prompt snapshot 👁**: tertiary, opens a side drawer with the `prompt_used` text, read-only. For audit / "why did claude do this".
  - **Submit (n) →**: primary button when `status=ready` and ≥1 finding selected. Disabled with tooltip "Select at least one finding" otherwise. The `(n)` is the live selected count.
  - **Delete session**: hidden in a `…` overflow menu next to actions. Confirmation modal: _"Delete session for #123? Submissions to GitHub are not undone."_
- Secondary toolbar (under header, sticky on scroll):
  - Tabs: `Active` (default) / `Archived` (after rerun) / `Submissions` (history of submissions to GitHub)
  - Filter chips: `All severities` · `Must` · `Should` · `Nit` (multi-select)
  - On the right: bulk-action buttons that appear when ≥1 finding is selected: **Select all visible** · **Clear selection** · selection count.

### 3.4 FindingCard internals

Visual order top→bottom:

````
┌─ [3px severity-color left border] ─────────────────────────────────────┐
│ ┌─ Header row ─────────────────────────────────────────────────────────┐│
│ │ [☐ checkbox]  R1  ●must  «Type Safety»  src/auth/jwt.ts:42  ↗       ││
│ │                                                       [✏ edit] [▾]  ││
│ └──────────────────────────────────────────────────────────────────────┘│
│ ┌─ Title row ──────────────────────────────────────────────────────────┐│
│ │  Don't trust unsigned JWT                                  [✎ edited]││
│ └──────────────────────────────────────────────────────────────────────┘│
│ ┌─ Body (rendered markdown by default) ────────────────────────────────┐│
│ │  The `verifyJWT` helper accepts a token and decodes it without...    ││
│ └──────────────────────────────────────────────────────────────────────┘│
│ ┌─ Diff slice ─────────────────────────────────────────────────────────┐│
│ │  40   import jwt from 'jsonwebtoken';                                ││
│ │  41                                                                  ││
│ │ ▶42   const decoded = jwt.decode(token);                             ││
│ │  43   return decoded;                                                ││
│ │  [Expand]   [Expand full hunk]                                       ││
│ └──────────────────────────────────────────────────────────────────────┘│
│ ┌─ Suggestion (if present) ────────────────────────────────────────────┐│
│ │ ```ts                                                                ││
│ │ const decoded = jwt.verify(token, secret);                           ││
│ │ ```                                                                  ││
│ └──────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────┘
````

Element details:

- **Checkbox** (`☐ / ☑`): leftmost, 16px, primary color. Bound to `selected`.
- **R1** ordinal: `font-mono text-xs text-gray-500`, click-to-copy with a fade tooltip "Copied".
- **Severity icon + label**: §2.1 tokens. Click the label to open severity selector (radio-toggle inline-replaces the static label).
- **Category chip**: `text-xs` neutral pill (`bg-gray-100 text-gray-700` / dark `bg-gray-800 text-gray-300`). Free-form text — claude generates it. Display unchanged.
- **File:line link**: `font-mono text-xs`, opens GitHub at the right line in a new tab (`url + #L<line>` from `pr.url` → `/files`). Internally also the anchor for keyboard navigation.
- **Edit pencil ✏**: opens edit mode (§4). Only visible on hover for cleanliness, but always rendered for accessibility (CSS `opacity-0 hover:opacity-100`, but `focus-within` keeps it visible).
- **Overflow ▾**: dropdown with: _Delete finding_, _Copy as markdown_, _Open in GitHub_.
- **Title**: `text-base font-medium`, rendered as markdown (inline only — no headings, no lists).
- **Body**: rendered with `react-markdown` + `rehype-highlight`. Supports `<details>`. Renderable code fences for any language.
- **Diff slice**: `react-diff-view` + `shiki`. Default: highlighted line ±3 (collapsed). One Expand button → ±10. Second Expand → full hunk. The active line gets a subtle left-arrow indicator (▶) and `bg-yellow-50/30`. No line numbers from the diff are clickable — this is read-only context.
- **Suggestion**: rendered as a syntax-highlighted code block in a faintly tinted card (`bg-blue-50/40` / `bg-blue-950/20`) with a "Suggestion" label.

PR-wide findings (`file=null`) skip the diff slice entirely and show a "(whole PR)" label where the file:line would be.

---

## 4. Edit mode UX

### 4.1 Trigger — RECOMMENDED: pencil icon + keyboard shortcut, no double-click

- **Pencil icon** (`✏`) in the card header is the canonical trigger. Hover-revealed on the desktop, always visible on touch.
- Keyboard: `e` while a card is focused enters edit mode for that card.
- **No double-click trigger.** Double-click is great for power users but disastrous for accidental clicks on body text — the spec mentions it but in practice double-click on rendered markdown competes with text selection. Pencil + `e` is unambiguous and discoverable.

### 4.2 Editor — RECOMMENDED: split textarea | preview, vertical

When edit mode is active for a card, the body section transforms:

```
┌─ Body editor ─────────────────────────────────────────────────────────┐
│ ┌── Markdown ──────────────┐ ┌── Preview ─────────────────────────┐   │
│ │ The `verifyJWT` helper   │ │ The verifyJWT helper accepts a     │   │
│ │ accepts a token and...   │ │ token and decodes it without...    │   │
│ │                          │ │                                    │   │
│ └──────────────────────────┘ └────────────────────────────────────┘   │
│                                              [Cancel]  [Save  ⌘↵]     │
└────────────────────────────────────────────────────────────────────────┘
```

- Split is **50/50 vertical** at ≥1024px viewport, **stacked (textarea above preview)** below 1024px.
- Textarea: `font-mono text-sm`, monospace, line-numbers off, autoresize to content (min 6 lines, max 24 lines before scroll).
- Preview: identical rendering to the read-mode body. Updates live (debounced 150ms).
- Tab inside textarea inserts a literal `  ` (two spaces). Shift+Tab unindents.

The severity selector and suggestion editor appear in the same edit mode session as additional fields beneath the body editor:

````
Severity:  [● Must]  [◐ Should]  [○ Nit]
Suggestion (optional):
┌─────────────────────────────────────┐
│ ```ts                                │
│ const decoded = jwt.verify(...)     │
│ ```                                  │
└─────────────────────────────────────┘
````

The title is editable in a single-line input above the body editor.

The category and file:line are **not editable in v1** — they come from claude's output and changing them risks misalignment with the diff slice. This is a deliberate scope cut; if user feedback demands it, revisit in v2.

### 4.3 Save — RECOMMENDED: explicit Save button (with `⌘↵` shortcut), not blur-save

Reasoning:

- Blur-save in markdown editors is dangerous: clicking outside the editor (e.g. to scroll, to click another finding to compare) silently commits potentially half-baked edits.
- Many other PR review tools (GitHub itself, Reviewable) use explicit save. Reviewers expect it.
- The spec mentions blur-saves but acknowledges no optimistic locking; an explicit save lets us also confirm "don't navigate away with unsaved changes" cleanly.

So:

- **Save**: button + `⌘↵` (Mac) / `Ctrl+Enter`. Sends `PATCH /api/findings/:id`. On success, exits edit mode; a small "Saved" microcopy appears for 1.5s next to the title.
- **Cancel**: button + `Esc`. If the editor content differs from the original, show a confirm popover _"Discard changes?"_ with **Discard** / **Keep editing**.
- Navigation guard: if the user clicks another route or another finding's edit, same confirm popover.

### 4.4 Conflict / staleness

Spec says no optimistic locking. Two options:

- (A) Show a passive "Updated elsewhere" notice when a `finding-updated` SSE arrives for a finding currently being edited; user decides whether to keep editing or refresh.
- (B) Hard overwrite, latest write wins.

**Recommend (A)** — implementation is a few lines, prevents nasty silent data loss when the user has multiple tabs open. The notice is non-blocking; user can ignore and keep typing.

---

## 5. SubmitDrawer flow

A right-side drawer (60% viewport width on ≥1280px, full-screen modal below) with a 4-step horizontal stepper at the top.

### Step 1 — Selection summary

```
┌─ Submit review ───────────────────────────────────[X close]─┐
│ [① Selection] → [② Event] → [③ Preview] → [④ Confirm]      │
│                                                             │
│ 12 findings selected of 18 total                            │
│  ● 3 must     ◐ 7 should     ○ 2 nit                        │
│                                                             │
│ ▾ 1 finding will be downgraded to body:                     │
│   • R7 (src/auth/jwt.ts:142) — line not in diff             │
│     ↳ Will appear in review body instead of inline          │
│                                                             │
│ ▾ 2 PR-wide findings will appear in review body:            │
│   • R6 — Consider extracting auth concerns…                 │
│   • R12 — Tests cover happy path only                       │
│                                                             │
│                                          [Cancel]   [Next →]│
└─────────────────────────────────────────────────────────────┘
```

Critically: degraded findings (line not in diff per server-side check from §8.3) are surfaced **here, before the user commits**, with a clear explanation. The check happens when the drawer opens — show a small inline spinner during the call.

### Step 2 — Event type

```
│ Choose review event type:                                   │
│                                                             │
│  ( )  💬  COMMENT                                           │
│        Leave comments without approving or rejecting.       │
│                                                             │
│  (•)  🚫  REQUEST_CHANGES                                   │
│        Block merge until addressed.                         │
│                                                             │
│  ( )  ✅  APPROVE                                           │
│        Mark as ready to merge.                              │
│                                                             │
│ Optional review body comment (markdown supported):          │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Overall the auth refactor is solid; mostly nits below.  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│                                  [← Back]    [Next →]       │
```

Default event: from `/settings.defaultReviewEvent`, but always editable here. The optional body textarea pre-fills with downgraded + PR-wide findings rendered as a list (the user can edit before sending).

### Step 3 — Preview the gh API payload

```
│ Preview of POST to GitHub:                                  │
│ POST /repos/owner/repo/pulls/123/reviews                    │
│                                                             │
│ ┌─ JSON ──────────────────────────────────────────────────┐ │
│ │ {                                                       │ │
│ │   "event": "REQUEST_CHANGES",                           │ │
│ │   "body": "Overall the auth refactor is solid…",        │ │
│ │   "comments": [                                         │ │
│ │     { "path": "src/auth/jwt.ts", "line": 42,            │ │
│ │       "body": "**Must · Type Safety**\n\n…" },          │ │
│ │     { ... 11 more ... }                                 │ │
│ │   ]                                                     │ │
│ │ }                                                       │ │
│ └─────────────────────────────────────────────────────────┘ │
│ [Copy JSON]                                                 │
│                                                             │
│                                   [← Back]    [Next →]      │
```

- JSON is rendered with shiki; collapsible with default-collapsed `comments` array (showing first 2 for context).
- "Copy JSON" copies to clipboard for users who want to invoke `gh api` manually instead.

### Step 4 — Confirm + submit

```
│ Submit review?                                              │
│                                                             │
│ • REQUEST_CHANGES on owner/repo#123                         │
│ • 11 inline comments                                        │
│ • 1 review body comment                                     │
│                                                             │
│ This will post immediately. There is no "draft" mode.       │
│                                                             │
│                                   [← Back]   [Submit ✓]    │
```

The Submit button shows an inline spinner during the gh call. On success, the drawer transitions to the **post-submit panel**:

```
│ ✓ Submitted                                                 │
│                                                             │
│ Review live at:                                             │
│   ↗ github.com/owner/repo/pull/123#pullrequestreview-…      │
│                                                             │
│ Posted: 11 inline comments + 1 body comment                 │
│ Event: REQUEST_CHANGES                                      │
│                                                             │
│                  [Open in GitHub]    [Close]                │
```

On failure, the post-submit panel is replaced by an error variant with the raw `gh` stderr in a `<details>`, plus a Retry button (which goes back to step 4, not the start).

---

## 6. Sidebar

### 6.1 Default sort & ordering

- Default sort: **most-recently-active first**. "Active" = `updated_at` from `pr_sessions`. Update happens on: status change, finding added, finding edited, submission.
- Group dividers: optional thin labels by status if there are >5 sessions (`Running`, `Ready`, `Submitted`, `Failed`, `Archived`). Within each group, recency-sorted. Toggle "Group by status" in `/settings`, default ON.

### 6.2 Sidebar width & item density

- Width: **280px fixed** at ≥1280px viewport, **240px** at smaller. Resizable handle is a future feature.
- Each item: 56px tall.

```
┌─ Sidebar ──────────────────────┐
│ [+ New PR review]              │  ← inline input area
│ ┌────────────────────────────┐ │
│ │ Enter PR # or URL          │ │
│ └────────────────────────────┘ │
│                                │
│ Filters: [All ▾]               │  ← single dropdown (status + repo)
│                                │
│ ── Running ──                  │
│ ┌────────────────────────────┐ │
│ │ ● feat(auth): JWT refresh  │ │  ← title 1 line, ellipsized
│ │   owner/repo#123 · 2:14    │ │  ← repo + elapsed/age
│ └────────────────────────────┘ │
│ ── Ready ──                    │
│ ┌────────────────────────────┐ │
│ │ ✓ fix: handle null token   │ │
│ │   owner/repo#101 · 5m ago  │ │
│ │   ●3 ◐7 ○2  ☑ 12/18        │ │  ← finding count by severity
│ └────────────────────────────┘ │
│ ┌────────────────────────────┐ │
│ │ ✗ chore: deps              │ │
│ │   owner/repo#88 · 1h ago   │ │
│ │   failed: gh pr view 404   │ │  ← short error
│ └────────────────────────────┘ │
└────────────────────────────────┘
```

- **Active session**: `bg-primary-50 border-l-2 border-primary-600`.
- **Hover**: `bg-gray-50 / bg-gray-900`.
- **Severity counts** (ready+submitted only) at the bottom — small, lets the user pick the highest-must PR first.
- **Status icon** at the leftmost edge ties to §2.2 colors. The status word itself is omitted (icon + group divider already convey it) to keep density manageable.

### 6.3 New-PR input — RECOMMENDED: inline at top of sidebar

- Inline persistent input, always visible. No modal.
- Placeholder: _"Enter PR # or URL"_. Examples in a subtle tooltip on focus.
- Submit on Enter; the input clears and the new session card animates in at the top. While `gh pr view` is fetching meta, show a placeholder card with a skeleton title.
- Why inline: the spec calls "+ New PR" the entry point and the user lands here often. A modal adds friction. The 56px input slot is cheap.

### 6.4 Filter chips

Single dropdown labeled `[All ▾]` to keep visual noise low. Inside the dropdown, two sections:

- _Status_: checkbox list (Running, Ready, Failed, Submitted, Archived). Default: all ON except Archived.
- _Repo_: checkbox list of repos found across sessions. Default: all ON.

Active filter shows as a pill: `[Status: 3 of 5 ▾]`.

### 6.5 Status badge density tradeoff

I chose **icon-only at the leftmost** instead of a full word badge. Rationale: at 280px width and 56px row height, the title needs every horizontal pixel. Icon + group divider gives the same information; a verbose pill would force ellipsis on the title earlier.

---

## 7. Prompt editor

```
┌──── /prompt ─────────────────────────────────────────────────────────┐
│  [Effective] [Project (~/Projects/foo)] [Global (~)]                 │
│   ▔▔▔▔▔▔▔▔▔                                                          │
│                                                                      │
│   Source: builtin (no project or global override)                    │
│                                                                      │
│  ┌─ Read-only effective prompt ────────────────────────────────────┐ │
│  │ # Review prompt                                                 │ │
│  │ You are reviewing a pull request...                             │ │
│  │ {{PR_META}}  {{DIFF}}  {{FINDINGS_PATH}}  {{SCHEMA}}            │ │
│  └────────────────────────────────────────────────────────────────-┘ │
│                                                                      │
│  [Override at this scope] (only on Project / Global tabs)            │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.1 Three tabs

- **Effective** (default tab): shows the currently-resolved prompt. Read-only. A subtitle says: _"Source: project / global / builtin"_.
- **Project**: editable when an override exists, otherwise shows `[Override at this scope]` button. Path label `<repo-cwd>/.better-review/review.md`.
- **Global**: same as project. Path label `~/.better-review/review.md`.

### 7.2 Diff preview

When the user is editing the Project tab and there's a Global override that would otherwise apply, show a **collapsible "Compare against fallback"** panel below the editor:

```
▾ Compare with what would otherwise apply (Global)
  - existing global line
  + your project edit
  - existing global line
```

Same component as `react-diff-view`; default collapsed, toggle persists in localStorage.

If the next-level fallback is `builtin` (no global), the panel diffs against builtin.

### 7.3 Save and reset

- **Save**: button + `⌘S`. Writes via `PUT /api/prompts/:scope`. On success, a microcopy _"Saved"_ fades next to the button.
- **Reset to fallback**: button on Project / Global tabs, secondary, with confirmation popover _"Delete <path>? The next-level fallback will apply."_.

### 7.4 "Apply to current session"

- Button at the top right of the editor, visible only when (a) at least one session exists in `running|ready|failed` status and (b) the editor content has been saved (not dirty).
- Click → modal: list of applicable sessions with checkboxes, default-checked = the most recent. **Apply (rerun)** button calls `POST /api/sessions/:id/rerun` for each checked session and routes to the first one's `/pr/:id`.
- Why a modal here vs inline: this is a side-effecty cross-page action; surfacing the affected sessions explicitly prevents "wait, which sessions did I rerun?" confusion.

---

## 8. Color tokens & typography

### 8.1 Tailwind palette (v3, light & dark)

| Role                         | Light                                                   | Dark                                                      |
| ---------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| **Primary**                  | `blue-600` (`bg-blue-600 text-white`); hover `blue-700` | `blue-500`; hover `blue-400`                              |
| Primary subtle               | `blue-50` bg, `blue-700` text                           | `blue-950/40` bg, `blue-300` text                         |
| **Surface** (page bg)        | `white` (or `gray-50` for the very outermost)           | `gray-950`                                                |
| Surface raised (cards)       | `white` with `border-gray-200`                          | `gray-900` with `border-gray-800`                         |
| Sidebar bg                   | `gray-50`                                               | `gray-900`                                                |
| **Border** default           | `border-gray-200`                                       | `border-gray-800`                                         |
| Border strong                | `border-gray-300`                                       | `border-gray-700`                                         |
| **Text** primary             | `text-gray-900`                                         | `text-gray-100`                                           |
| Text secondary               | `text-gray-600`                                         | `text-gray-400`                                           |
| Text muted                   | `text-gray-500`                                         | `text-gray-500`                                           |
| Text inverted (on primary)   | `text-white`                                            | `text-white`                                              |
| **Severity**                 | see §2.1                                                | see §2.1                                                  |
| **Status**                   | see §2.2                                                | see §2.2                                                  |
| Focus ring                   | `ring-2 ring-blue-500 ring-offset-1`                    | `ring-2 ring-blue-400 ring-offset-1 ring-offset-gray-950` |
| Highlight (active diff line) | `bg-yellow-50`                                          | `bg-yellow-950/30`                                        |

shadcn/ui's CSS variables (`--background`, `--foreground`, `--primary`, etc.) should map to these tokens via Tailwind config — define both modes there once.

### 8.2 Typography

- **Font stack**:
  - Body: `Inter, ui-sans-serif, system-ui, -apple-system, sans-serif`. Inter loaded as a self-hosted woff2 (no Google Fonts CDN — local-first principle and offline functionality).
  - Mono: `JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace`. For: ordinal IDs (R1), file:line, code blocks, diff slices.
- **Sizes** (default + dark mode use the same):

| Use                        | Tailwind                            | px    |
| -------------------------- | ----------------------------------- | ----- |
| PR title (header)          | `text-lg`                           | 18    |
| Card title                 | `text-base`                         | 16    |
| Body text                  | `text-sm`                           | 14    |
| Sidebar item title         | `text-sm`                           | 14    |
| Sidebar metadata           | `text-xs`                           | 12    |
| Labels / chips / file:line | `text-xs`                           | 12    |
| Code (mono)                | `text-xs` to `text-sm` (responsive) | 12–14 |

- **Line-height**: `leading-snug` for headings, `leading-relaxed` for markdown body, `leading-tight` for code.
- **Density**: comfortable, not cramped. Cards use `p-4`; sidebar items use `px-3 py-2`. No font sizes below 12px anywhere.

---

## 9. Light/dark mode — RECOMMEND: support both, default to system

The spec doesn't mandate either, but:

- This is a developer tool used over multi-hour sessions. Dark mode is non-negotiable for many users.
- Both modes share the token system (§8.1) — implementation cost is low.
- Default: `prefers-color-scheme` system, with a manual toggle in `/settings` (System / Light / Dark).
- Dark mode is **first-class**, not an afterthought. Test every component in both during PR review of the frontend.

---

## 10. Accessibility

### 10.1 Keyboard shortcuts

Global:

- `?` — open shortcuts cheatsheet modal
- `g` then `h` — go home
- `g` then `p` — go to prompt
- `g` then `s` — go to settings
- `/` — focus the new-PR input in sidebar
- `[` / `]` — previous / next PR in sidebar

PR detail:

- `j` / `k` — next / previous finding (focus moves, scrolls into view)
- `x` — toggle selection on focused finding
- `e` — edit focused finding
- `o` — open finding's GitHub link in new tab
- `Esc` — exit edit mode (with confirm if dirty)
- `⌘↵` / `Ctrl+Enter` — save in edit mode
- `Shift+S` — open SubmitDrawer
- `R` — rerun session (with confirm)

Within SubmitDrawer:

- `Enter` — advance step
- `Esc` — close (with confirm if mid-flow)

All shortcuts must be discoverable via the `?` cheatsheet.

### 10.2 Focus and ARIA

- All interactive elements have visible focus rings (§8.1 token).
- FindingCard has `role="article"`, `aria-labelledby` pointing to its title, and the severity badge has `aria-label="Severity: must"` etc.
- Severity is **not** conveyed by color alone — every severity has a unique icon (●/◐/○) plus a text label in the badge. Same for statuses.
- Selection checkbox is a native `<input type="checkbox">` for screen-reader semantics, visually styled with Tailwind.
- The FindingList is wrapped in `role="list"` with each card `role="listitem"`.
- Diff slices use `role="region"` with `aria-label="Code context for finding R1"`.

### 10.3 Color contrast

All text/background combinations in §8.1 are checked against WCAG AA (4.5:1 for normal text, 3:1 for large/UI). Specifically:

- `text-gray-600` on `white`: 4.83:1 ✓
- `text-gray-400` on `gray-950`: 7.2:1 ✓
- `text-red-700` on `red-50`: 6.1:1 ✓
- `text-emerald-700` on `emerald-50`: 5.8:1 ✓ (slightly lower than red but passes)
- `text-amber-700` on `amber-50`: 5.4:1 ✓

The `gray-500` muted text is intentionally borderline (4.5:1 on white) — only used for low-stakes metadata.

### 10.4 Other a11y

- Reduced motion: respect `prefers-reduced-motion`. The running-status pulse and skeleton shimmer become static when set.
- Screen reader announce on SSE events (live region with `aria-live="polite"`): "Finding R3 added", "Session ready".
- Tooltip text always available as `aria-label` or visible text — never tooltip-only critical info.

---

## 11. Component-level checklist for frontend-dev

Use this when building each component. If you can't satisfy a row, ping `designer` before guessing.

| Component    | Empty state            | Loading state    | Error state   | Severity tokens   | Status tokens | Keyboard        | A11y            |
| ------------ | ---------------------- | ---------------- | ------------- | ----------------- | ------------- | --------------- | --------------- |
| Sidebar      | §1.3 first-time        | skeleton items   | red band §1.5 | n/a               | §2.2          | `[/]/[/]`       | role=navigation |
| HealthBanner | hidden                 | n/a              | always        | n/a               | n/a           | dismissible? no | `role=alert`    |
| FindingList  | §1.3 0-findings        | skeleton 3 cards | inline        | n/a               | n/a           | `j/k/x/e/o`     | `role=list`     |
| FindingCard  | n/a                    | skeleton         | red border    | §2.1              | n/a           | `j/k` focus     | `role=article`  |
| DiffSlice    | "no slice for PR-wide" | skeleton lines   | inline        | n/a               | n/a           | none            | `role=region`   |
| EditMode     | n/a                    | inline spinner   | inline        | severity selector | n/a           | `Esc/⌘↵`        | trap focus      |
| SubmitDrawer | n/a                    | step-3 spinner   | step-4 error  | n/a               | n/a           | `Enter/Esc`     | trap focus      |
| PromptEditor | builtin only           | skeleton         | inline        | n/a               | n/a           | `⌘S`            | n/a             |
| HomePage     | §1.3 first-time        | skeleton cards   | inline        | n/a               | n/a           | `Enter` submit  | n/a             |
| SettingsPage | n/a                    | n/a              | inline        | n/a               | n/a           | tab order       | label/input     |

---

## 12. Open questions / tensions noticed in spec

(Captured here so frontend-dev knows what's resolved vs. what was a judgment call.)

1. **Edit trigger** — Spec §6.6 says "双击 finding 卡片 → 编辑". This guideline replaces double-click with pencil icon + `e` shortcut for the reasons in §4.1. **Verify with team-lead before implementation if you want to keep double-click.**
2. **Save semantics** — Spec §8.2 says "blur 触发 PATCH"; this guideline switches to explicit save (§4.3). Same flag for team-lead.
3. **Two-column vs. single-column layout** — Spec §6.6 doesn't specify; I picked single-column inline-diff (§3.2). Strong recommendation, but reversible if user testing shows otherwise.
4. **PR-wide findings rendering on the page** — Spec doesn't describe how `file=null` findings appear; this guideline gives them their own section (§3.2). Consistent with the submit drawer's separation.
5. **Sidebar status badge density** — Iconic vs. word badges; chose iconic for width reasons. Acceptable to revisit.
6. **Light vs. dark default** — Spec is silent; this picks system-default with override (§9). Easy change.
7. **"Submitted" → editable** — Spec §8.5 says editing is allowed post-submit. UI should make this visible without being noisy: I propose a passive "Submitted 2h ago — 1 submission · last: COMMENT" line in the header, and edits don't add any "unsubmitted changes" badge until the user opens the SubmitDrawer again. Open to alternatives.

---

## 13. What this document does NOT cover (and why)

- **Animation specifics** beyond reduced-motion respect — kept open for frontend-dev's taste within a "calm, fast" envelope.
- **Pixel-perfect spacing** — Tailwind scale should suffice; avoid arbitrary values.
- **Concrete library API choices** (e.g. exact `react-diff-view` props) — those are implementation, not design.
- **Mobile layout** — out of scope; this is a desktop dev tool.
- **i18n** — English-only v1.

If the implementation surfaces a UX question this doc doesn't answer, ping `designer` rather than inventing.
