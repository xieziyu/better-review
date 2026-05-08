// Picks the right source-context strategy for a session: a per-session git
// worktree at PR head when the user has pinned a local clone, otherwise a
// partial snapshot of diff-touched files. Returns kind:'none' on failure so
// the session still runs in legacy diff-only mode rather than aborting.

import type { SourceKind } from '../../shared/types'
import type { GhClient } from '../github/gh-client'
import type { PRTarget } from '../github/pr-target-parser'
import type { Logger } from '../logger'
import { prepareDiffSnapshot, snapshotDirFor } from './snapshot'
import { prepareWorktree, worktreeDirFor } from './worktree'

export interface SourceContext {
  kind: SourceKind
  // Directory the agent should treat as its source root. Empty string for
  // 'none' (no source — agent only sees the diff).
  sourcePath: string
  // PR head SHA used to materialise the source. Surfaced to the prompt so
  // the agent knows what state it's looking at.
  headSha: string
  // Set only when kind === 'worktree' so cleanup can remove the temp ref.
  refName: string | null
  // True when the source is incomplete (snapshot covers only diff-touched
  // files; full repos / no-source are not partial).
  partial: boolean
}

export interface PrepareSourceContextArgs {
  localRepoPath: string | null
  gh: GhClient
  target: PRTarget
  headSha: string
  unifiedDiff: string
  sessionWorkdir: string
  sessionShort: string
  log: Logger
}

export async function prepareSourceContext(args: PrepareSourceContextArgs): Promise<SourceContext> {
  const { localRepoPath, gh, target, headSha, unifiedDiff, sessionWorkdir, sessionShort, log } =
    args

  if (localRepoPath) {
    try {
      const worktreeDir = worktreeDirFor(sessionWorkdir)
      const r = await prepareWorktree({
        localRepoPath,
        owner: target.owner,
        repo: target.repo,
        prNumber: target.number,
        headSha,
        worktreeDir,
        sessionShort,
        log,
      })
      return {
        kind: 'worktree',
        sourcePath: r.worktreeDir,
        headSha: r.resolvedSha,
        refName: r.refName,
        partial: false,
      }
    } catch (e) {
      log.warn('worktree prep failed; falling back to snapshot', {
        error: (e as Error).message,
      })
      // fall through to snapshot
    }
  }

  if (!headSha) {
    log.warn('no headSha; running diff-only')
    return { kind: 'none', sourcePath: '', headSha: '', refName: null, partial: false }
  }

  try {
    const r = await prepareDiffSnapshot({
      gh,
      owner: target.owner,
      repo: target.repo,
      headSha,
      unifiedDiff,
      snapshotDir: snapshotDirFor(sessionWorkdir),
      log,
    })
    return {
      kind: 'snapshot',
      sourcePath: r.snapshotDir,
      headSha,
      refName: null,
      partial: true,
    }
  } catch (e) {
    log.warn('snapshot prep failed; running diff-only', { error: (e as Error).message })
    return { kind: 'none', sourcePath: '', headSha, refName: null, partial: false }
  }
}
