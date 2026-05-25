// Single entry point that turns the user's `prInput` string + optional
// hints into a concrete SessionSource. URL-shaped inputs route to
// github-pr (unchanged behavior); absolute/`~`-prefixed paths route to
// local-branch with sensible defaults that the Phase 1d Home UI will be
// able to override per-session.

import type { SessionSource } from '../../shared/source'
import { parsePRTarget } from '../github/pr-target-parser'
import { resolveLocalRepoPath } from '../paths'

export interface ParseSessionInputOpts {
  // Branch / ref / sha the user wants to review. Defaults to HEAD.
  localBranchHead?: string
  // Diff base. Defaults to 'auto' (LocalBranchFlow resolves at runtime
  // via `refs/remotes/origin/HEAD` → `origin/main` → `origin/master`).
  localBranchBase?: string
}

const URL_PREFIX_RE = /^https?:\/\//i

// A path-shaped input is anything that isn't a URL and starts with `/`
// or `~`. Bare names (e.g. `myrepo`) are rejected so a user pasting a
// half-typed PR URL doesn't silently become a "local repo" lookup.
function looksLikePath(input: string): boolean {
  if (URL_PREFIX_RE.test(input)) return false
  return input.startsWith('/') || input.startsWith('~')
}

export function parseSessionInput(input: string, opts: ParseSessionInputOpts = {}): SessionSource {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new Error('input is empty')
  }

  if (URL_PREFIX_RE.test(trimmed)) {
    const t = parsePRTarget(trimmed)
    return { kind: 'github-pr', owner: t.owner, repo: t.repo, number: t.number }
  }

  if (looksLikePath(trimmed)) {
    const repoPath = resolveLocalRepoPath(trimmed)
    return {
      kind: 'local-branch',
      repoPath,
      head: opts.localBranchHead?.trim() || 'HEAD',
      base: opts.localBranchBase?.trim() || 'auto',
    }
  }

  throw new Error(
    'input must be a GitHub PR URL (https://github.com/<owner>/<repo>/pull/<n>) or an absolute local repo path',
  )
}
