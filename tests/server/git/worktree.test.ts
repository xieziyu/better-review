import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { cleanupWorktree, prepareWorktree, worktreeDirFor } from '../../../src/server/git/worktree'

interface NoopLog {
  info: (m: string, ctx?: unknown) => void
  warn: (m: string, ctx?: unknown) => void
  error: (m: string, ctx?: unknown) => void
}
const noopLog: NoopLog = { info: () => {}, warn: () => {}, error: () => {} }

function git(cwd: string, ...args: string[]): string {
  return execSync(`git ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Tester',
      GIT_AUTHOR_EMAIL: 'tester@example.com',
      GIT_COMMITTER_NAME: 'Tester',
      GIT_COMMITTER_EMAIL: 'tester@example.com',
      // Block any user-level git config from leaking into tests (signing keys
      // etc. would break the dummy commits below).
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  }).toString()
}

interface Fixture {
  upstream: string
  userClone: string
  prHeadSha: string
}

// Stand up a bare repo whose URL ends in `github.com/o/r.git` (so
// findGithubRemote matches) plus a "user clone" pointing at it. Push two
// commits so the bare repo has both a base SHA (on main) and a PR head SHA
// (on refs/pull/1/head).
function setupFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'br-wt-'))
  // Mimic GitHub's URL shape so the remote regex hits.
  const upstreamPath = join(root, 'github.com', 'o', 'r.git')
  mkdirSync(upstreamPath, { recursive: true })
  git(upstreamPath, 'init', '--bare', '--initial-branch=main')

  // Seed repo to push from.
  const seedDir = join(root, 'seed')
  mkdirSync(seedDir)
  git(seedDir, 'init', '--initial-branch=main')
  writeFileSync(join(seedDir, 'README.md'), 'base\n')
  git(seedDir, 'add', 'README.md')
  git(seedDir, 'commit', '-m', 'base')
  git(seedDir, 'remote', 'add', 'origin', upstreamPath)
  git(seedDir, 'push', 'origin', 'main')

  // Add a PR-head commit on a feature branch and publish it under the
  // pull/1/head ref the way GitHub does.
  writeFileSync(join(seedDir, 'feature.ts'), 'export const x = 1\n')
  git(seedDir, 'add', 'feature.ts')
  git(seedDir, 'commit', '-m', 'feat')
  const prHeadSha = git(seedDir, 'rev-parse', 'HEAD').trim()
  git(seedDir, 'push', 'origin', `HEAD:refs/pull/1/head`)

  // User's pinned clone — fresh clone of the bare repo (so origin URL
  // includes `github.com/o/r.git`).
  const userClone = mkdtempSync(join(tmpdir(), 'br-wt-clone-'))
  git(userClone, 'clone', upstreamPath, '.')
  return { upstream: upstreamPath, userClone, prHeadSha }
}

describe('git/worktree', () => {
  let fx: Fixture
  beforeEach(() => {
    fx = setupFixture()
  })

  it('prepareWorktree creates a worktree at PR head and returns the resolved SHA', async () => {
    const sessionWorkdir = mkdtempSync(join(tmpdir(), 'br-wt-sess-'))
    const worktreeDir = worktreeDirFor(sessionWorkdir)
    const r = await prepareWorktree({
      localRepoPath: fx.userClone,
      owner: 'o',
      repo: 'r',
      prNumber: 1,
      headSha: fx.prHeadSha,
      worktreeDir,
      sessionShort: 'abcd1234',
      log: noopLog,
    })
    expect(r.worktreeDir).toBe(worktreeDir)
    expect(r.refName).toBe('refs/better-review/pr-1-abcd1234')
    expect(r.resolvedSha).toBe(fx.prHeadSha)
    // The worktree's HEAD must be at PR head, and the diff-touched file
    // must be present (this is the post-merge state).
    const head = git(worktreeDir, 'rev-parse', 'HEAD').trim()
    expect(head).toBe(fx.prHeadSha)
    expect(existsSync(join(worktreeDir, 'feature.ts'))).toBe(true)
  })

  it('cleanupWorktree removes the working dir, registry entry, and ref', async () => {
    const sessionWorkdir = mkdtempSync(join(tmpdir(), 'br-wt-sess-'))
    const worktreeDir = worktreeDirFor(sessionWorkdir)
    const r = await prepareWorktree({
      localRepoPath: fx.userClone,
      owner: 'o',
      repo: 'r',
      prNumber: 1,
      headSha: fx.prHeadSha,
      worktreeDir,
      sessionShort: 'abcd1234',
      log: noopLog,
    })
    expect(existsSync(worktreeDir)).toBe(true)
    expect(git(fx.userClone, 'worktree', 'list').toString()).toContain(worktreeDir)
    expect(git(fx.userClone, 'for-each-ref', r.refName).toString().trim()).not.toBe('')

    await cleanupWorktree({
      localRepoPath: fx.userClone,
      worktreeDir,
      refName: r.refName,
      log: noopLog,
    })
    expect(existsSync(worktreeDir)).toBe(false)
    expect(git(fx.userClone, 'worktree', 'list').toString()).not.toContain(worktreeDir)
    expect(git(fx.userClone, 'for-each-ref', r.refName).toString().trim()).toBe('')
  })

  it('throws WorktreePrepError when the pinned path is not a git repo', async () => {
    const notGit = mkdtempSync(join(tmpdir(), 'br-wt-notgit-'))
    const sessionWorkdir = mkdtempSync(join(tmpdir(), 'br-wt-sess-'))
    await expect(
      prepareWorktree({
        localRepoPath: notGit,
        owner: 'o',
        repo: 'r',
        prNumber: 1,
        headSha: fx.prHeadSha,
        worktreeDir: worktreeDirFor(sessionWorkdir),
        sessionShort: 'sssss',
        log: noopLog,
      }),
    ).rejects.toThrow(/not a git repository/)
  })

  it('throws WorktreePrepError when no remote points at the PR target', async () => {
    // Re-init the user clone with an unrelated remote.
    execSync(`git -C '${fx.userClone}' remote remove origin`)
    execSync(`git -C '${fx.userClone}' remote add origin file:///tmp/somewhere-else.git`)
    const sessionWorkdir = mkdtempSync(join(tmpdir(), 'br-wt-sess-'))
    await expect(
      prepareWorktree({
        localRepoPath: fx.userClone,
        owner: 'o',
        repo: 'r',
        prNumber: 1,
        headSha: fx.prHeadSha,
        worktreeDir: worktreeDirFor(sessionWorkdir),
        sessionShort: 'sssss',
        log: noopLog,
      }),
    ).rejects.toThrow(/no git remote/)
  })
})
