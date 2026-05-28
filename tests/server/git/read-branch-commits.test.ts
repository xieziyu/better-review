// Direct exercise of readBranchCommits against an on-disk git repo —
// no mocks, mirrors the list-local-branches test style.

import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { readBranchCommits } from '../../../src/server/git/local-branch'

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

describe('readBranchCommits', () => {
  let repo: string

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'br-readcommits-'))
    git(repo, 'init', '--initial-branch=main')
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'initial')
  })

  it('returns an empty array when head == base', async () => {
    const commits = await readBranchCommits(repo, 'main', 'main')
    expect(commits).toEqual([])
  })

  it('returns a single entry when the branch is one commit ahead', async () => {
    git(repo, 'checkout', '-b', 'feat')
    writeFileSync(join(repo, 'b.txt'), 'two\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'add b')
    const commits = await readBranchCommits(repo, 'main', 'feat')
    expect(commits).toHaveLength(1)
    expect(commits[0]?.subject).toBe('add b')
    expect(commits[0]?.author).toBe('Tester')
    expect(commits[0]?.body).toBe('')
    expect(commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('returns commits oldest → newest with bodies preserved', async () => {
    git(repo, 'checkout', '-b', 'feat')
    writeFileSync(join(repo, 'b.txt'), 'two\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'first feat commit\n\nwhy first')
    writeFileSync(join(repo, 'c.txt'), 'three\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'second feat commit')
    writeFileSync(join(repo, 'd.txt'), 'four\n')
    git(repo, 'add', '.')
    // A body containing a blank line — verifies the RS-separator survives
    // multi-paragraph commit messages instead of splitting them apart.
    git(repo, 'commit', '-m', 'third feat commit\n\npara one\n\npara two')
    const commits = await readBranchCommits(repo, 'main', 'feat')
    expect(commits.map((c) => c.subject)).toEqual([
      'first feat commit',
      'second feat commit',
      'third feat commit',
    ])
    expect(commits[0]?.body).toBe('why first')
    expect(commits[1]?.body).toBe('')
    expect(commits[2]?.body).toBe('para one\n\npara two')
  })

  it('rejects option-shaped revs', async () => {
    await expect(readBranchCommits(repo, '--output=/tmp/x', 'main')).rejects.toThrow(
      /must not start with '-'/,
    )
    await expect(readBranchCommits(repo, 'main', '--exec=evil')).rejects.toThrow(
      /must not start with '-'/,
    )
  })
})
