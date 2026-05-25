import { serializeSource, type SessionSource } from '@shared/source'
import type { PRSession } from '@shared/types'

// True for any non-GitHub-PR session — local-branch or gitbutler-vbranch.
// Used to gate Submit, GitHub-only badges, and round counters in the UI.
export function isLocalSource(source: SessionSource): boolean {
  return source.kind === 'local-branch' || source.kind === 'gitbutler-vbranch'
}

// Basename of an absolute repo path (`/Users/me/Projects/foo` → `foo`).
// Falls back to the raw path when there is no trailing segment.
export function repoBasename(repoPath: string): string {
  return repoPath.replace(/\/+$/, '').split('/').pop() ?? repoPath
}

// Human-readable identity for a session, in the same form the user types it.
// PR: `owner/repo#number` · local: `<basename> · <branch>` · vbranch:
// `<basename> · ⌥<vbranchName>`.
export function sessionDisplayLabel(session: PRSession): string {
  const source = session.source
  if (source.kind === 'local-branch') {
    const branch = session.headRef ?? source.head
    return `${repoBasename(source.repoPath)} · ${branch}`
  }
  if (source.kind === 'gitbutler-vbranch') {
    return `${repoBasename(source.repoPath)} · ${source.vbranchName}`
  }
  return `${session.owner}/${session.repo}#${session.number}`
}

// Cross-session identity predicate. Two sessions are "the same source" iff
// their canonical SessionSource serializes to the same string. This avoids
// the empty-string-owner / 0-number collision that the old PR-shaped
// (owner,repo,number) match would produce for local sources.
export function sameSource(a: PRSession, b: PRSession): boolean {
  return serializeSource(a.source) === serializeSource(b.source)
}

