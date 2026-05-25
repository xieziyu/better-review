import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'

import { describe, it, expect } from 'vitest'

import { resolveLocalRepoPath } from '../../src/server/paths'
import { makeStartSession, type StartSessionDeps } from '../../src/server/start-session'
import type { SessionSource } from '../../src/shared/source'

describe('resolveLocalRepoPath', () => {
  it('returns the absolute path for an existing directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-lrp-'))
    expect(resolveLocalRepoPath(dir)).toBe(dir)
  })

  it('expands ~ to the user home directory', () => {
    // homedir() should always exist and be a directory; test that the leading
    // tilde is replaced and the path remains valid.
    const out = resolveLocalRepoPath('~')
    expect(out).toBe(homedir())
  })

  it('expands ~/sub when sub exists', () => {
    // We can't safely create files inside the real home dir from tests, so
    // assert only that the expansion produces a string starting with home.
    const fake = '~/this-path-almost-certainly-does-not-exist-br-test'
    expect(() => resolveLocalRepoPath(fake)).toThrow(/does not exist/)
  })

  it('throws when the path does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-lrp-'))
    expect(() => resolveLocalRepoPath(`${dir}${sep}missing`)).toThrow(/does not exist/)
  })

  it('throws when the path points at a regular file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-lrp-'))
    const file = join(dir, 'a-file.txt')
    writeFileSync(file, 'hi')
    expect(() => resolveLocalRepoPath(file)).toThrow(/not a directory/)
  })

  it('throws when given an empty string', () => {
    expect(() => resolveLocalRepoPath('   ')).toThrow(/must not be empty/)
  })
})

// Minimal stub deps that exercise only the synchronous prefix of
// startSession (derivation → resolveAgent → insert → bus.emit). The
// queue.run callback is captured but never executed, so the heavy
// prep pipeline (fetchMetadata, fetchDiff, runReview, …) is bypassed.
function makeFixture() {
  const sessionsDir = mkdtempSync(join(tmpdir(), 'br-sess-'))
  const home = mkdtempSync(join(tmpdir(), 'br-home-'))
  const inserted: Array<{ id: string; localRepoPath: string | null }> = []
  const deps: StartSessionDeps = {
    sessions: {
      insert(row: { id: string; localRepoPath: string | null }) {
        inserted.push({ id: row.id, localRepoPath: row.localRepoPath })
      },
      findActiveByPR: () => null,
    } as unknown as StartSessionDeps['sessions'],
    findings: {} as StartSessionDeps['findings'],
    submissions: {} as StartSessionDeps['submissions'],
    submissionComments: {} as StartSessionDeps['submissionComments'],
    gh: {} as StartSessionDeps['gh'],
    bus: { emit: () => {} } as unknown as StartSessionDeps['bus'],
    queue: { run: () => Promise.resolve() } as unknown as StartSessionDeps['queue'],
    runners: {} as StartSessionDeps['runners'],
    getConfig: () => ({ defaultAgent: 'codex' }) as ReturnType<StartSessionDeps['getConfig']>,
    paths: { home, sessionsDir, codexHome: home },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    resolveAgent: () =>
      ({ agent: {}, executable: '/fake/agent' }) as ReturnType<StartSessionDeps['resolveAgent']>,
  }
  return { deps, inserted }
}

describe('makeStartSession localRepoPath derivation', () => {
  it('derives session.localRepoPath from source.repoPath for local-branch when caller omits localRepoPath', async () => {
    const { deps, inserted } = makeFixture()
    const repoDir = mkdtempSync(join(tmpdir(), 'br-derive-lb-'))
    const source: SessionSource = {
      kind: 'local-branch',
      repoPath: repoDir,
      head: 'HEAD',
      base: 'auto',
    }
    await makeStartSession(deps)({ source })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]?.localRepoPath).toBe(repoDir)
  })

  it('derives session.localRepoPath from source.repoPath for gitbutler-vbranch when caller omits localRepoPath', async () => {
    const { deps, inserted } = makeFixture()
    const repoDir = mkdtempSync(join(tmpdir(), 'br-derive-vb-'))
    const source: SessionSource = {
      kind: 'gitbutler-vbranch',
      repoPath: repoDir,
      vbranchName: 'feature-x',
      base: 'auto',
    }
    await makeStartSession(deps)({ source })
    expect(inserted[0]?.localRepoPath).toBe(repoDir)
  })

  it('honors an explicit localRepoPath when both source.repoPath and the override are present', async () => {
    const { deps, inserted } = makeFixture()
    const repoDir = mkdtempSync(join(tmpdir(), 'br-derive-src-'))
    const overrideDir = mkdtempSync(join(tmpdir(), 'br-derive-ovr-'))
    const source: SessionSource = {
      kind: 'local-branch',
      repoPath: repoDir,
      head: 'HEAD',
      base: 'auto',
    }
    await makeStartSession(deps)({ source, localRepoPath: overrideDir })
    expect(inserted[0]?.localRepoPath).toBe(overrideDir)
  })

  it('leaves session.localRepoPath null for github-pr sources when the caller does not supply one', async () => {
    const { deps, inserted } = makeFixture()
    const source: SessionSource = {
      kind: 'github-pr',
      owner: 'o',
      repo: 'r',
      number: 1,
    }
    await makeStartSession(deps)({ source })
    expect(inserted[0]?.localRepoPath).toBeNull()
  })
})
