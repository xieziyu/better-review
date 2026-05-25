// Source-tree prep for the local-branch flow. Mirrors source-prep.ts but
// targets the user's pinned repo directly — there is no gh fetch step
// because the head sha already lives in the local clone. Returns the
// same SourceContext shape so the rest of the engine (prompt rendering,
// agent spawn, cleanup) is source-kind-agnostic.

import { existsSync } from 'node:fs'

import { execa } from 'execa'

import type { Logger } from '../logger'
import type { SourceContext } from './source-prep'
import { worktreeDirFor } from './worktree'

export interface PrepareLocalSourceContextArgs {
  repoPath: string
  headSha: string
  sessionWorkdir: string
  log: Logger
}

// Add a detached worktree at `headSha`. We deliberately use the resolved
// sha (not a branch/ref name) so the worktree pins to a stable snapshot
// even if the user pushes more commits to the same branch mid-review.
// Cleanup goes through the shared `cleanupWorktree` in worktree.ts —
// with `refName: null` it only runs `worktree remove` + `prune`.
export async function prepareLocalSourceContext(
  args: PrepareLocalSourceContextArgs,
): Promise<SourceContext> {
  const { repoPath, headSha, sessionWorkdir, log } = args
  const worktreeDir = worktreeDirFor(sessionWorkdir)
  try {
    if (existsSync(worktreeDir)) {
      // A previous attempt may have left an empty dir behind. Best-effort
      // prune so `git worktree add` doesn't refuse on retry.
      await execa('git', ['-C', repoPath, 'worktree', 'prune'], { reject: false })
    }
    const added = await execa(
      'git',
      ['-C', repoPath, 'worktree', 'add', '--detach', worktreeDir, headSha],
      { reject: false },
    )
    if (added.exitCode !== 0) {
      throw new Error(`git worktree add failed: ${String(added.stderr).slice(0, 300)}`)
    }
    log.info('local worktree ready', {
      repoPath,
      worktreeDir,
      sha: headSha.slice(0, 12),
    })
    return {
      kind: 'worktree',
      sourcePath: worktreeDir,
      headSha,
      // No temp ref to clean up — the worktree was created from the sha
      // directly, so delete-session's `cleanupWorktree` only needs to
      // remove the dir + worktree registry entry.
      refName: null,
      partial: false,
    }
  } catch (e) {
    log.warn('local worktree prep failed; running diff-only', {
      error: (e as Error).message,
    })
    return { kind: 'none', sourcePath: '', headSha, refName: null, partial: false }
  }
}
