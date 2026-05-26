import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { listLocalBranches } from '../../../src/server/git/local-branch'

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
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  }).toString()
}

describe('listLocalBranches', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'br-list-'))
    git(repo, 'init', '--initial-branch=main')
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'one')
  })

  it('returns the single branch and HEAD shortname', async () => {
    const { head, branches } = await listLocalBranches(repo)
    expect(head).toBe('main')
    expect(branches).toHaveLength(1)
    expect(branches[0]?.name).toBe('main')
    expect(branches[0]?.sha).toMatch(/^[0-9a-f]{7,}$/)
    expect(Number.isFinite(branches[0]?.committedAt)).toBe(true)
  })

  it('orders branches by committerdate descending', async () => {
    // Create an older branch first by checking out a fresh branch at the
    // initial commit, then make a newer commit on main. for-each-ref
    // --sort=-committerdate should put main on top.
    git(repo, 'branch', 'older')
    writeFileSync(join(repo, 'b.txt'), 'two\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'two')

    const { branches } = await listLocalBranches(repo)
    expect(branches.map((b) => b.name)).toEqual(['main', 'older'])
  })

  it('reports null head when in a detached state', async () => {
    const sha = git(repo, 'rev-parse', 'HEAD').trim()
    git(repo, 'checkout', '--detach', sha)
    const { head } = await listLocalBranches(repo)
    expect(head).toBeNull()
  })

  it('returns an empty list for a repo with no branches', async () => {
    // Fresh init, no commits → for-each-ref refs/heads is empty
    const fresh = mkdtempSync(join(tmpdir(), 'br-empty-'))
    git(fresh, 'init', '--initial-branch=main')
    const { head, branches } = await listLocalBranches(fresh)
    // `rev-parse --abbrev-ref HEAD` against an unborn branch returns the
    // shortname even though no commit exists yet; the picker still
    // displays it. The branches list is empty.
    expect(branches).toEqual([])
    expect(head === null || head === 'main').toBe(true)
  })
})
