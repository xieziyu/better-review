import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { snapshotDirFor } from '../../src/server/git/snapshot'
import { worktreeDirFor } from '../../src/server/git/worktree'
import { reuseSourceContext } from '../../src/server/start-session'
import type { PRSession, SourceKind } from '../../src/shared/types'

function fakeSession(over: Partial<PRSession>): PRSession {
  return {
    id: 's1',
    source: { kind: 'github-pr', owner: 'o', repo: 'r', number: 1 },
    owner: 'o',
    repo: 'r',
    number: 1,
    title: null,
    author: null,
    url: null,
    baseRef: null,
    headRef: null,
    status: 'failed',
    agent: 'claude',
    createdAt: 0,
    updatedAt: 0,
    workdir: '/w',
    localRepoPath: null,
    sourceKind: null,
    sourceRefName: null,
    promptUsed: 'p',
    extraPrompt: null,
    headSha: null,
    error: null,
    reviewSummary: null,
    excludedFiles: [],
    ...over,
  }
}

describe('reuseSourceContext', () => {
  it('returns null when sourceKind was never persisted (prep did not complete)', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'br-reuse-'))
    expect(reuseSourceContext(fakeSession({ workdir, sourceKind: null }), workdir)).toBeNull()
  })

  it('reuses a worktree when the dir exists, carrying refName + headSha', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'br-reuse-'))
    mkdirSync(worktreeDirFor(workdir), { recursive: true })
    const ctx = reuseSourceContext(
      fakeSession({ workdir, sourceKind: 'worktree', sourceRefName: 'refs/x', headSha: 'abc' }),
      workdir,
    )
    expect(ctx).toEqual({
      kind: 'worktree',
      sourcePath: worktreeDirFor(workdir),
      headSha: 'abc',
      refName: 'refs/x',
      partial: false,
    })
  })

  it('returns null for a worktree session whose dir is gone (forces rebuild)', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'br-reuse-'))
    expect(reuseSourceContext(fakeSession({ workdir, sourceKind: 'worktree' }), workdir)).toBeNull()
  })

  it('reuses a snapshot when the dir exists and marks it partial', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'br-reuse-'))
    mkdirSync(snapshotDirFor(workdir), { recursive: true })
    const ctx = reuseSourceContext(
      fakeSession({ workdir, sourceKind: 'snapshot', headSha: 'def' }),
      workdir,
    )
    expect(ctx).toEqual({
      kind: 'snapshot',
      sourcePath: snapshotDirFor(workdir),
      headSha: 'def',
      refName: null,
      partial: true,
    })
  })

  it('reuses a "none" source without touching the filesystem', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'br-reuse-'))
    const ctx = reuseSourceContext(
      fakeSession({ workdir, sourceKind: 'none' as SourceKind, headSha: 'h' }),
      workdir,
    )
    expect(ctx).toEqual({
      kind: 'none',
      sourcePath: '',
      headSha: 'h',
      refName: null,
      partial: false,
    })
  })
})
