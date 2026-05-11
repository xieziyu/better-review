import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { SessionsRepo } from '../../../src/server/db/sessions'
import { SubmissionCommentsRepo } from '../../../src/server/db/submission-comments'
import { SubmissionsRepo } from '../../../src/server/db/submissions'

describe('SubmissionCommentsRepo', () => {
  let sessions: SessionsRepo
  let submissions: SubmissionsRepo
  let comments: SubmissionCommentsRepo
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-sc-'))
    const db = openDatabase(join(dir, 's.db'))
    sessions = new SessionsRepo(db)
    submissions = new SubmissionsRepo(db)
    comments = new SubmissionCommentsRepo(db)
    sessions.insert({
      id: 'sess-old',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'archived',
      agent: 'claude',
      workdir: '/w',
      localRepoPath: null,
      promptUsed: 'p',
    })
  })

  it('insertMany + listBySubmission preserves order', () => {
    const subId = submissions.insert({
      sessionId: 'sess-old',
      event: 'COMMENT',
      githubUrl: null,
      githubReviewId: 42,
      payloadJson: '{}',
      findingIds: [],
      error: null,
    })
    comments.insertMany(subId, [
      {
        findingDbId: 'f1',
        githubCommentId: 1,
        file: 'a.ts',
        line: 10,
        startLine: null,
        title: 't1',
        body: 'b1',
      },
      {
        findingDbId: 'f2',
        githubCommentId: 2,
        file: 'a.ts',
        line: 20,
        startLine: 18,
        title: 't2',
        body: 'b2',
      },
    ])
    const got = comments.listBySubmission(subId)
    expect(got).toHaveLength(2)
    expect(got[0]!.title).toBe('t1')
    expect(got[1]!.startLine).toBe(18)
  })

  it('listByPR ignores errored submissions', () => {
    const ok = submissions.insert({
      sessionId: 'sess-old',
      event: 'COMMENT',
      githubUrl: null,
      githubReviewId: 1,
      payloadJson: '{}',
      findingIds: [],
      error: null,
    })
    const bad = submissions.insert({
      sessionId: 'sess-old',
      event: 'COMMENT',
      githubUrl: null,
      githubReviewId: null,
      payloadJson: '{}',
      findingIds: [],
      error: 'boom',
    })
    comments.insertMany(ok, [
      {
        findingDbId: null,
        githubCommentId: null,
        file: 'a.ts',
        line: 5,
        startLine: null,
        title: 'kept',
        body: 'kept',
      },
    ])
    comments.insertMany(bad, [
      {
        findingDbId: null,
        githubCommentId: null,
        file: 'a.ts',
        line: 9,
        startLine: null,
        title: 'dropped',
        body: 'dropped',
      },
    ])
    const list = comments.listByPR('o', 'r', 1)
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe('kept')
  })
})
