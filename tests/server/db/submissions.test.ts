import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { SessionsRepo } from '../../../src/server/db/sessions'
import { SubmissionsRepo } from '../../../src/server/db/submissions'

describe('SubmissionsRepo', () => {
  let repo: SubmissionsRepo
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-sub-'))
    const db = openDatabase(join(dir, 's.db'))
    new SessionsRepo(db).insert({
      id: 's1',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'ready',
      agent: 'claude',
      workdir: '/w',
      localRepoPath: null,
      promptUsed: 'p',
    })
    repo = new SubmissionsRepo(db)
  })

  it('insert + listBySession', () => {
    const id = repo.insert({
      sessionId: 's1',
      event: 'COMMENT',
      githubUrl: 'https://gh/x',
      githubReviewId: 42,
      payloadJson: '{}',
      findingIds: ['a', 'b'],
      error: null,
    })
    const list = repo.listBySession('s1')
    expect(list[0]!.id).toBe(id)
    expect(list[0]!.findingIds).toEqual(['a', 'b'])
    expect(list[0]!.event).toBe('COMMENT')
    expect(list[0]!.githubReviewId).toBe(42)
  })

  it('latestSuccessfulForSession ignores errored submissions', () => {
    repo.insert({
      sessionId: 's1',
      event: 'COMMENT',
      githubUrl: null,
      githubReviewId: null,
      payloadJson: '{}',
      findingIds: [],
      error: 'boom',
    })
    const okId = repo.insert({
      sessionId: 's1',
      event: 'COMMENT',
      githubUrl: 'https://gh/x',
      githubReviewId: 7,
      payloadJson: '{}',
      findingIds: [],
      error: null,
    })
    expect(repo.latestSuccessfulForSession('s1')?.id).toBe(okId)
  })
})
