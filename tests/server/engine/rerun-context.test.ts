import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { SessionsRepo } from '../../../src/server/db/sessions'
import { SubmissionCommentsRepo } from '../../../src/server/db/submission-comments'
import { SubmissionsRepo } from '../../../src/server/db/submissions'
import { loadPriorReviewContext } from '../../../src/server/engine/rerun-context'
import type {
  GhClient,
  GhCompare,
  GhIssueComment,
  GhReview,
  GhReviewComment,
} from '../../../src/server/github/gh-client'

interface StubResult {
  reviews?: GhReview[]
  pulls?: GhReviewComment[]
  issues?: GhIssueComment[]
  compare?: GhCompare | Error
}

function stubGh(r: StubResult): GhClient {
  return {
    listReviews: async () => r.reviews ?? [],
    listAllPRComments: async () => r.pulls ?? [],
    listIssueComments: async () => r.issues ?? [],
    compareCommits: async () => {
      if (r.compare instanceof Error) throw r.compare
      return (
        r.compare ?? { status: 'ahead', ahead_by: 1, behind_by: 0, total_commits: 1, files: [] }
      )
    },
  } as unknown as GhClient
}

const NOOP_LOG = { info: () => {}, warn: () => {}, error: () => {} }

describe('loadPriorReviewContext', () => {
  let sessions: SessionsRepo
  let submissions: SubmissionsRepo
  let submissionComments: SubmissionCommentsRepo
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-rc-'))
    const db = openDatabase(join(dir, 's.db'))
    sessions = new SessionsRepo(db)
    submissions = new SubmissionsRepo(db)
    submissionComments = new SubmissionCommentsRepo(db)
  })

  it('returns null when no archived prior session exists', async () => {
    const ctx = await loadPriorReviewContext(
      { sessions, submissions, submissionComments, gh: stubGh({}), log: NOOP_LOG },
      { target: { owner: 'o', repo: 'r', number: 1 }, currentHeadSha: 'newsha', prAuthor: 'alice' },
    )
    expect(ctx).toBeNull()
  })

  it('threads author replies under each of our top-level inline comments', async () => {
    sessions.insert({
      id: 'prior',
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
      headSha: 'oldsha',
    })
    submissions.insert({
      sessionId: 'prior',
      event: 'COMMENT',
      githubUrl: 'https://github.com/o/r/pull/1#pullrequestreview-42',
      githubReviewId: 42,
      payloadJson: '{}',
      findingIds: [],
      error: null,
    })
    const ctx = await loadPriorReviewContext(
      {
        sessions,
        submissions,
        submissionComments,
        gh: stubGh({
          reviews: [
            {
              id: 42,
              user: { login: 'me' },
              state: 'COMMENTED',
              body: 'overall',
              commit_id: 'oldsha',
              submitted_at: null,
              html_url: '',
            },
          ],
          pulls: [
            {
              id: 1000,
              pull_request_review_id: 42,
              user: { login: 'me' },
              path: 'a.ts',
              line: 5,
              start_line: null,
              side: 'RIGHT',
              start_side: null,
              commit_id: 'oldsha',
              original_commit_id: 'oldsha',
              in_reply_to_id: null,
              body: 'top-level finding',
              created_at: '2026-05-01T00:00:00Z',
            },
            {
              id: 1001,
              pull_request_review_id: null,
              user: { login: 'alice' },
              path: 'a.ts',
              line: 5,
              start_line: null,
              side: 'RIGHT',
              start_side: null,
              commit_id: 'oldsha',
              original_commit_id: 'oldsha',
              in_reply_to_id: 1000,
              body: 'already fixed',
              created_at: '2026-05-02T00:00:00Z',
            },
          ],
          compare: {
            status: 'ahead',
            ahead_by: 1,
            behind_by: 0,
            total_commits: 1,
            files: [],
          },
        }),
        log: NOOP_LOG,
      },
      { target: { owner: 'o', repo: 'r', number: 1 }, currentHeadSha: 'newsha', prAuthor: 'alice' },
    )
    expect(ctx).not.toBeNull()
    expect(ctx!.lastReviewedSha).toBe('oldsha')
    expect(ctx!.isForcePushed).toBe(false)
    expect(ctx!.inlineComments).toHaveLength(1)
    expect(ctx!.inlineComments[0]!.replies).toHaveLength(1)
    expect(ctx!.inlineComments[0]!.replies[0]!.isAuthor).toBe(true)
    expect(ctx!.reviewBody).toBe('overall')
    expect(ctx!.priorRoundCount).toBe(1)
  })

  it('marks isForcePushed when compare reports diverged', async () => {
    sessions.insert({
      id: 'prior',
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
      headSha: 'oldsha',
    })
    const ctx = await loadPriorReviewContext(
      {
        sessions,
        submissions,
        submissionComments,
        gh: stubGh({
          compare: {
            status: 'diverged',
            ahead_by: 1,
            behind_by: 2,
            total_commits: 1,
            files: [],
          },
        }),
        log: NOOP_LOG,
      },
      { target: { owner: 'o', repo: 'r', number: 1 }, currentHeadSha: 'newsha', prAuthor: 'alice' },
    )
    expect(ctx!.isForcePushed).toBe(true)
  })

  it('falls back to parsing github_review_id from the url for legacy rows', async () => {
    sessions.insert({
      id: 'prior',
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
      headSha: 'oldsha',
    })
    submissions.insert({
      sessionId: 'prior',
      event: 'COMMENT',
      githubUrl: 'https://github.com/o/r/pull/1#pullrequestreview-42',
      githubReviewId: null,
      payloadJson: '{}',
      findingIds: [],
      error: null,
    })
    const ctx = await loadPriorReviewContext(
      {
        sessions,
        submissions,
        submissionComments,
        gh: stubGh({
          reviews: [
            {
              id: 42,
              user: { login: 'me' },
              state: 'COMMENTED',
              body: '',
              commit_id: 'oldsha',
              submitted_at: null,
              html_url: '',
            },
          ],
          pulls: [
            {
              id: 1000,
              pull_request_review_id: 42,
              user: { login: 'me' },
              path: 'a.ts',
              line: 5,
              start_line: null,
              side: 'RIGHT',
              start_side: null,
              commit_id: 'oldsha',
              original_commit_id: 'oldsha',
              in_reply_to_id: null,
              body: 'top-level',
              created_at: '',
            },
          ],
        }),
        log: NOOP_LOG,
      },
      { target: { owner: 'o', repo: 'r', number: 1 }, currentHeadSha: 'newsha', prAuthor: 'alice' },
    )
    expect(ctx!.inlineComments).toHaveLength(1)
  })
})
