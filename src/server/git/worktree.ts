// Per-session git worktree at PR head, derived from the user's pinned local
// clone. Lets the agent read source files at the same SHA the diff was taken
// at — without touching the user's main working tree (so GitButler virtual
// branches and any in-flight work stay untouched).

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { execa } from 'execa'

import type { Logger } from '../logger'
import { findGithubRemote } from './remote-match'

export interface PrepareWorktreeArgs {
  localRepoPath: string
  owner: string
  repo: string
  prNumber: number
  headSha: string
  // Where to materialise the worktree. Caller chooses; usually
  // <session-workdir>/repo so cleanup follows the session's lifecycle.
  worktreeDir: string
  // Short suffix that disambiguates the temporary ref when the same PR has
  // multiple concurrent sessions (e.g. session ID first 8 chars).
  sessionShort: string
  log: Logger
}

export interface WorktreeResult {
  worktreeDir: string
  refName: string
  matchedRemote: string
  resolvedSha: string
}

export class WorktreePrepError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'WorktreePrepError'
  }
}

export async function prepareWorktree(args: PrepareWorktreeArgs): Promise<WorktreeResult> {
  const { localRepoPath, owner, repo, prNumber, headSha, worktreeDir, sessionShort, log } = args

  // 1. Confirm the pinned path is a git repo. `git rev-parse --git-dir`
  //    succeeds inside any working tree (including worktrees).
  const gitDir = await execa('git', ['-C', localRepoPath, 'rev-parse', '--git-dir'], {
    reject: false,
  })
  if (gitDir.exitCode !== 0) {
    throw new WorktreePrepError(
      `pinned path is not a git repository: ${localRepoPath}\n${String(gitDir.stderr).slice(0, 200)}`,
    )
  }

  // 2. Find a remote that points at the PR's owner/repo on GitHub. We need
  //    this for the fetch step; without it we'd be guessing.
  const remotes = await execa('git', ['-C', localRepoPath, 'remote', '-v'], { reject: false })
  if (remotes.exitCode !== 0) {
    throw new WorktreePrepError(
      `git remote -v failed in ${localRepoPath}: ${String(remotes.stderr).slice(0, 200)}`,
    )
  }
  const matched = findGithubRemote(String(remotes.stdout), owner, repo)
  if (!matched) {
    throw new WorktreePrepError(
      `no git remote in ${localRepoPath} points at github.com/${owner}/${repo} — pin a clone of that repo or add a matching remote`,
    )
  }

  // 3. Fetch the PR head into a private ref namespace. GitHub serves every
  //    PR (including those from forks) under the parent repo's pull/<N>/head
  //    ref, so this works regardless of where the PR originated.
  const refName = `refs/better-review/pr-${prNumber}-${sessionShort}`
  const fetchSpec = `pull/${prNumber}/head:${refName}`
  const fetched = await execa(
    'git',
    ['-C', localRepoPath, 'fetch', '--no-tags', matched, fetchSpec, '--force'],
    { reject: false },
  )
  if (fetched.exitCode !== 0) {
    throw new WorktreePrepError(
      `git fetch ${matched} ${fetchSpec} failed: ${String(fetched.stderr).slice(0, 300)}`,
    )
  }

  // 4. Verify the fetched ref's commit matches the SHA we got from gh. If a
  //    race updated the PR between gh pr view and our fetch, fall through to
  //    the fetched commit; the diff was taken at the same instant as the
  //    headSha so a mismatch is rare but logged.
  const resolved = await execa('git', ['-C', localRepoPath, 'rev-parse', refName], {
    reject: false,
  })
  if (resolved.exitCode !== 0) {
    throw new WorktreePrepError(`could not resolve ${refName} after fetch`)
  }
  const resolvedSha = String(resolved.stdout).trim()
  if (headSha && resolvedSha !== headSha) {
    log.warn('worktree headSha drift', { expected: headSha, got: resolvedSha, prNumber })
  }

  // 5. Create the worktree pointed at the ref. `--detach` keeps it on a
  //    detached HEAD so we never accidentally interact with branch state.
  if (existsSync(worktreeDir)) {
    // A previous attempt may have left an empty dir behind. Best-effort prune
    // before retrying so `git worktree add` doesn't refuse.
    await execa('git', ['-C', localRepoPath, 'worktree', 'prune'], { reject: false })
  }
  const added = await execa(
    'git',
    ['-C', localRepoPath, 'worktree', 'add', '--detach', worktreeDir, refName],
    { reject: false },
  )
  if (added.exitCode !== 0) {
    // Best-effort: drop the ref so we don't leak it on retry.
    await execa('git', ['-C', localRepoPath, 'update-ref', '-d', refName], { reject: false })
    throw new WorktreePrepError(`git worktree add failed: ${String(added.stderr).slice(0, 300)}`)
  }

  log.info('worktree ready', {
    localRepoPath,
    worktreeDir,
    refName,
    sha: resolvedSha.slice(0, 12),
  })
  return { worktreeDir, refName, matchedRemote: matched, resolvedSha }
}

export interface CleanupWorktreeArgs {
  localRepoPath: string
  worktreeDir: string
  refName: string | null
  log: Logger
}

// Remove the per-session worktree directory and the temporary ref. Best-
// effort: failures are logged and swallowed so the caller's main cleanup
// path (DB delete, workdir rmSync) is never blocked.
export async function cleanupWorktree(args: CleanupWorktreeArgs): Promise<void> {
  const { localRepoPath, worktreeDir, refName, log } = args
  // `git worktree remove --force` deletes both the working dir and the
  // registry entry under .git/worktrees/<name>/. Skip if the dir is already
  // gone (e.g. someone deleted it manually).
  try {
    if (existsSync(worktreeDir)) {
      const r = await execa(
        'git',
        ['-C', localRepoPath, 'worktree', 'remove', '--force', worktreeDir],
        { reject: false },
      )
      if (r.exitCode !== 0) {
        log.warn('git worktree remove failed', {
          worktreeDir,
          stderr: String(r.stderr).slice(0, 200),
        })
      }
    }
    // Idempotent prune covers the case where remove failed or the dir was
    // pre-deleted out from under us.
    await execa('git', ['-C', localRepoPath, 'worktree', 'prune'], { reject: false })
  } catch (e) {
    log.warn('worktree cleanup errored', { error: (e as Error).message })
  }

  if (refName) {
    try {
      await execa('git', ['-C', localRepoPath, 'update-ref', '-d', refName], { reject: false })
    } catch (e) {
      log.warn('worktree ref delete errored', { refName, error: (e as Error).message })
    }
  }
}

// Helper: derive the canonical worktree directory for a session. Kept here
// (not in paths.ts) so callers that need to build the dir before persisting
// the session row share the same convention.
export function worktreeDirFor(sessionWorkdir: string): string {
  return join(sessionWorkdir, 'repo')
}
