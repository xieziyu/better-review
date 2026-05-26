// End-to-end smoke test for LocalBranchFlow against a real on-disk git
// repo. Mirrors the existing worktree.test.ts pattern — `execa('git', …)`
// is the only side-effect, no mocks.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { execa } from 'execa'
import { beforeAll, describe, expect, it } from 'vitest'

import { makeLocalBranchFlow } from '../../../src/server/source/local-branch-flow'
import type { LocalBranchSource } from '../../../src/shared/source'

interface Fixture {
  repoPath: string
  headSha: string
  branchName: string
}

// A minimal repo with two commits on a feature branch off main.
async function buildRepo(): Promise<Fixture> {
  const repoPath = mkdtempSync(join(tmpdir(), 'br-lbflow-'))
  // -b main covers older git versions where init.defaultBranch is master.
  await execa('git', ['-C', repoPath, 'init', '-b', 'main'])
  await execa('git', ['-C', repoPath, 'config', 'user.email', 'test@example.com'])
  await execa('git', ['-C', repoPath, 'config', 'user.name', 'Test User'])
  writeFileSync(join(repoPath, 'README.md'), '# initial\n')
  await execa('git', ['-C', repoPath, 'add', '.'])
  await execa('git', ['-C', repoPath, 'commit', '-m', 'initial commit'])
  await execa('git', ['-C', repoPath, 'checkout', '-b', 'feat/local-flow-test'])
  writeFileSync(join(repoPath, 'README.md'), '# initial\n\nadded a feature\n')
  writeFileSync(join(repoPath, 'NEW.md'), 'brand new file\n')
  await execa('git', ['-C', repoPath, 'add', '.'])
  await execa('git', [
    '-C',
    repoPath,
    'commit',
    '-m',
    'add the feature\n\nlonger body describing why',
  ])
  const sha = String((await execa('git', ['-C', repoPath, 'rev-parse', 'HEAD'])).stdout).trim()
  return { repoPath, headSha: sha, branchName: 'feat/local-flow-test' }
}

let fixture: Fixture
beforeAll(async () => {
  fixture = await buildRepo()
})

describe('makeLocalBranchFlow', () => {
  function source(): LocalBranchSource {
    return {
      kind: 'local-branch',
      repoPath: fixture.repoPath,
      head: 'HEAD',
      // 'main' is reachable as a local branch in the fixture; resolveBase
      // accepts any git revspec here so we pass it directly to avoid
      // depending on the user's remote configuration.
      base: 'main',
    }
  }

  it('fetchMetadata returns commit subject, author, and head sha', async () => {
    const flow = makeLocalBranchFlow(source())
    const m = await flow.fetchMetadata()
    expect(m.headSha).toBe(fixture.headSha)
    expect(m.title).toBe('add the feature')
    expect(m.author).toBe('Test User')
    expect(m.body).toContain('longer body describing why')
    expect(m.url).toBeNull()
    expect(m.baseRef).toBe('main')
    expect(m.headRef).toBe(fixture.branchName)
  })

  it('fetchDiff returns a unified diff that includes only the feature commit', async () => {
    const flow = makeLocalBranchFlow(source())
    const d = await flow.fetchDiff()
    expect(d.unifiedDiff).toMatch(/\+brand new file/)
    expect(d.unifiedDiff).toMatch(/diff --git a\/NEW\.md b\/NEW\.md/)
    // README.md grew — make sure the diff captures the added line.
    expect(d.unifiedDiff).toMatch(/\+added a feature/)
  })

  it('loadPriorContext always returns null', async () => {
    const flow = makeLocalBranchFlow(source())
    const prior = await flow.loadPriorContext({} as never)
    expect(prior).toBeNull()
  })

  it('buildSourceMeta includes the branch ref, sha prefix, base, and subject', async () => {
    const flow = makeLocalBranchFlow(source())
    const m = await flow.fetchMetadata()
    const meta = flow.buildSourceMeta(m)
    expect(meta).toContain(fixture.branchName)
    expect(meta).toContain(fixture.headSha.slice(0, 12))
    expect(meta).toContain('base: main')
    expect(meta).toContain('by Test User')
    expect(meta).toContain('add the feature')
  })
})
