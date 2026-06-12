// Partial source snapshot at PR head — fallback for users who haven't pinned
// a local clone. We can't get callers/siblings without a full repo, but
// fetching the diff-touched files at the PR head SHA still beats the agent
// having to imagine post-merge content from `+`/`-` lines.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { GhFileNotFoundError, GhFileTooLargeError } from '../github/errors'
import type { GhClient } from '../github/gh-client'
import type { Logger } from '../logger'

export interface PrepareSnapshotArgs {
  gh: GhClient
  owner: string
  repo: string
  headSha: string
  unifiedDiff: string
  // Where to write the snapshot tree. Caller chooses; usually
  // <session-workdir>/source. Files preserve their repo-relative paths
  // beneath this root.
  snapshotDir: string
  log: Logger
}

export interface SnapshotResult {
  snapshotDir: string
  fetched: string[]
  skipped: Array<{ path: string; reason: 'deleted' | 'not_found' | 'too_large' | 'error' }>
}

// Extract the set of "post" file paths from a unified diff. Pulls them out of
// `+++ b/<path>` lines; ignores `+++ /dev/null` (file deleted) so we don't
// try to fetch ghost files. Used for both the snapshot fetch and any future
// per-file analysis.
export function changedPathsFromDiff(unifiedDiff: string): string[] {
  const out = new Set<string>()
  for (const line of unifiedDiff.split('\n')) {
    if (!line.startsWith('+++ ')) continue
    const after = line.slice(4).trim()
    if (after === '/dev/null') continue
    // git's unified diffs prefix paths with `b/` (and `a/` for the `---` side).
    // Strip when present; otherwise take the rest verbatim.
    const path = after.startsWith('b/') ? after.slice(2) : after
    if (!path || path === '/dev/null') continue
    out.add(path)
  }
  return [...out]
}

// Every path a unified diff touches, on BOTH the pre- and post-image sides
// (`--- a/<old>` and `+++ b/<new>`), excluding /dev/null. The file-content
// endpoint uses this as a read allowlist so it can only ever serve files that
// actually appear in the review diff — covering renames (old + new path) and
// deletions (old path) — rather than any path in the repo / GitHub head.
export function diffTouchedPaths(unifiedDiff: string): Set<string> {
  const out = new Set<string>()
  for (const line of unifiedDiff.split('\n')) {
    if (!line.startsWith('+++ ') && !line.startsWith('--- ')) continue
    const after = line.slice(4).trim()
    if (after === '/dev/null') continue
    const path = after.startsWith('a/') || after.startsWith('b/') ? after.slice(2) : after
    if (path && path !== '/dev/null') out.add(path)
  }
  return out
}

export async function prepareDiffSnapshot(args: PrepareSnapshotArgs): Promise<SnapshotResult> {
  const { gh, owner, repo, headSha, unifiedDiff, snapshotDir, log } = args
  mkdirSync(snapshotDir, { recursive: true })
  const paths = changedPathsFromDiff(unifiedDiff)
  const fetched: string[] = []
  const skipped: SnapshotResult['skipped'] = []

  for (const path of paths) {
    try {
      const body = await gh.getFileAtRef({ owner, repo, path, ref: headSha })
      const dst = join(snapshotDir, path)
      mkdirSync(dirname(dst), { recursive: true })
      writeFileSync(dst, body)
      fetched.push(path)
    } catch (e) {
      if (e instanceof GhFileNotFoundError) {
        // File doesn't exist at HEAD — almost always a pure deletion (the
        // diff's "+++" was already /dev/null and we filtered it; this branch
        // catches submodule pointers and similar oddities).
        skipped.push({ path, reason: 'deleted' })
      } else if (e instanceof GhFileTooLargeError) {
        skipped.push({ path, reason: 'too_large' })
        log.warn('snapshot skip too-large', { path })
      } else {
        skipped.push({ path, reason: 'error' })
        log.warn('snapshot fetch failed', { path, error: (e as Error).message })
      }
    }
  }

  log.info('snapshot ready', {
    snapshotDir,
    fetched: fetched.length,
    skipped: skipped.length,
    sha: headSha.slice(0, 12),
  })
  return { snapshotDir, fetched, skipped }
}

export function snapshotDirFor(sessionWorkdir: string): string {
  return join(sessionWorkdir, 'source')
}
