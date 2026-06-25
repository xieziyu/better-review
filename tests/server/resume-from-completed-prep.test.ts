import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { snapshotDirFor } from '../../src/server/git/snapshot'
import { worktreeDirFor } from '../../src/server/git/worktree'
import { resumeFromCompletedPrep } from '../../src/server/start-session'
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
    promptUsed: 'rendered-prompt',
    extraPrompt: null,
    headSha: null,
    error: null,
    reviewSummary: null,
    excludedFiles: [],
    ...over,
  }
}

describe('resumeFromCompletedPrep', () => {
  it('returns null when promptUsed is blank (prep never finished)', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'br-resume-'))
    mkdirSync(worktreeDirFor(workdir), { recursive: true })
    expect(
      resumeFromCompletedPrep(
        fakeSession({ workdir, promptUsed: '   ', sourceKind: 'worktree' }),
        workdir,
      ),
    ).toBeNull()
  })

  it('returns null when prep finished but the source tree is gone (forces rebuild)', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'br-resume-'))
    expect(
      resumeFromCompletedPrep(fakeSession({ workdir, sourceKind: 'worktree' }), workdir),
    ).toBeNull()
  })

  it('reuses the persisted prompt with no sourcePath for a diff-only ("none") session', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'br-resume-'))
    const prep = resumeFromCompletedPrep(
      fakeSession({ workdir, sourceKind: 'none' as SourceKind, headSha: 'h' }),
      workdir,
    )
    expect(prep).toEqual({ prompt: 'rendered-prompt', sourcePath: null })
  })

  it('reuses the persisted prompt + worktree path when the worktree dir exists', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'br-resume-'))
    mkdirSync(worktreeDirFor(workdir), { recursive: true })
    const prep = resumeFromCompletedPrep(
      fakeSession({ workdir, sourceKind: 'worktree', headSha: 'abc' }),
      workdir,
    )
    expect(prep).toEqual({ prompt: 'rendered-prompt', sourcePath: worktreeDirFor(workdir) })
  })

  it('reuses the persisted prompt + snapshot path when the snapshot dir exists', () => {
    const workdir = mkdtempSync(join(tmpdir(), 'br-resume-'))
    mkdirSync(snapshotDirFor(workdir), { recursive: true })
    const prep = resumeFromCompletedPrep(
      fakeSession({ workdir, sourceKind: 'snapshot', headSha: 'def' }),
      workdir,
    )
    expect(prep).toEqual({ prompt: 'rendered-prompt', sourcePath: snapshotDirFor(workdir) })
  })
})
