import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { FindingsRepo } from '../../../src/server/db/findings'
import { SessionsRepo } from '../../../src/server/db/sessions'
import { SubmissionCommentsRepo } from '../../../src/server/db/submission-comments'
import { SubmissionsRepo } from '../../../src/server/db/submissions'
import { submitSession } from '../../../src/server/engine/submit'
import type { GhClient, GhReviewComment, ReviewPayload } from '../../../src/server/github/gh-client'
import type { PRTarget } from '../../../src/server/github/pr-target-parser'

const DIFF = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -10,1 +10,2 @@
 a
+b
`

function setup() {
  const wd = mkdtempSync(join(tmpdir(), 'br-sub-wd-'))
  writeFileSync(join(wd, 'diff.cache'), DIFF)
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'br-')), 's.db'))
  const sessions = new SessionsRepo(db)
  const findings = new FindingsRepo(db)
  const submissions = new SubmissionsRepo(db)
  const submissionComments = new SubmissionCommentsRepo(db)
  sessions.insert({
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
    workdir: wd,
    localRepoPath: null,
    promptUsed: 'p',
  })
  return { sessions, findings, submissions, submissionComments }
}

function ghStub(
  opts: {
    onSubmit?: (p: ReviewPayload) => void
    reviewId?: number
    comments?: GhReviewComment[]
    shouldThrow?: boolean
  } = {},
): GhClient {
  const reviewId = opts.reviewId ?? 1
  return {
    submitReview: async (_t: PRTarget, p: ReviewPayload) => {
      if (opts.shouldThrow) throw new Error('boom')
      opts.onSubmit?.(p)
      return { html_url: 'https://gh', id: reviewId }
    },
    listAllPRComments: async () => opts.comments ?? [],
  } as unknown as GhClient
}

describe('submitSession', () => {
  it('calls gh, records submission, returns URL + dropped', async () => {
    const { sessions, findings, submissions, submissionComments } = setup()
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'foo.ts',
        line: 11,
        title: 't1',
        body: 'b1',
      },
      {
        id: 'R2',
        severity: 'nit',
        category: 'x',
        file: 'foo.ts',
        line: 99,
        title: 't2',
        body: 'b2',
      },
    ])
    let received: ReviewPayload | null = null
    const gh = ghStub({ onSubmit: (p) => (received = p) })
    const out = await submitSession({
      sessionId: 's1',
      event: 'COMMENT',
      sessions,
      findings,
      submissions,
      submissionComments,
      gh,
    })
    expect(out.url).toBe('https://gh')
    expect(out.droppedToBody).toHaveLength(1)
    expect(out.skippedDuplicates).toBe(0)
    expect(received).not.toBeNull()
    expect(received!.comments).toHaveLength(1)
    expect(submissions.listBySession('s1')).toHaveLength(1)
    expect(sessions.getById('s1')!.status).toBe('submitted')
  })

  it('only includes selected findings', async () => {
    const { sessions, findings, submissions, submissionComments } = setup()
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'foo.ts',
        line: 11,
        title: 't1',
        body: 'b1',
      },
      {
        id: 'R2',
        severity: 'must',
        category: 'x',
        file: 'foo.ts',
        line: 11,
        title: 't2',
        body: 'b2',
      },
    ])
    const all = findings.listBySession('s1')
    findings.setSelected(all[1]!.dbId, false)
    let received: ReviewPayload | null = null
    const gh = ghStub({ onSubmit: (p) => (received = p) })
    await submitSession({
      sessionId: 's1',
      event: 'COMMENT',
      sessions,
      findings,
      submissions,
      submissionComments,
      gh,
    })
    expect(received!.comments).toHaveLength(1)
    expect(received!.comments[0]!.body).toContain('t1')
  })

  it('records error submission and rethrows on gh failure', async () => {
    const { sessions, findings, submissions, submissionComments } = setup()
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'foo.ts',
        line: 11,
        title: 't1',
        body: 'b1',
      },
    ])
    const gh = ghStub({ shouldThrow: true })
    await expect(
      submitSession({
        sessionId: 's1',
        event: 'COMMENT',
        sessions,
        findings,
        submissions,
        submissionComments,
        gh,
      }),
    ).rejects.toThrow('boom')
    const subs = submissions.listBySession('s1')
    expect(subs).toHaveLength(1)
    expect(subs[0]!.error).toBe('boom')
    expect(subs[0]!.githubUrl).toBeNull()
    expect(subs[0]!.githubReviewId).toBeNull()
  })

  it('persists submission_comments with finding mapping and GitHub ids on success', async () => {
    const { sessions, findings, submissions, submissionComments } = setup()
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'foo.ts',
        line: 11,
        title: 't1',
        body: 'b1',
      },
    ])
    const gh = ghStub({
      reviewId: 5000,
      comments: [
        {
          id: 9001,
          pull_request_review_id: 5000,
          user: { login: 'me' },
          path: 'foo.ts',
          line: 11,
          start_line: null,
          side: 'RIGHT',
          start_side: null,
          commit_id: 'sha',
          original_commit_id: 'sha',
          in_reply_to_id: null,
          // GitHub echoes the body we sent verbatim.
          body: '🔴 **[MUST]** t1\n\nb1',
          created_at: '2026-05-11T00:00:00Z',
        },
      ],
    })
    await submitSession({
      sessionId: 's1',
      event: 'COMMENT',
      sessions,
      findings,
      submissions,
      submissionComments,
      gh,
    })
    const subs = submissions.listBySession('s1')
    expect(subs[0]!.githubReviewId).toBe(5000)
    const sc = submissionComments.listByPR('o', 'r', 1)
    expect(sc).toHaveLength(1)
    expect(sc[0]!.file).toBe('foo.ts')
    expect(sc[0]!.line).toBe(11)
    expect(sc[0]!.githubCommentId).toBe(9001)
    expect(sc[0]!.findingDbId).toBe(findings.listBySession('s1')[0]!.dbId)
  })

  it('renders file-level manual findings into the review body, not as inline comments', async () => {
    // GitHub's create-review endpoint rejects subject_type:'file' in
    // comments[], so file-level manual findings can't be posted as
    // file-anchored inline comments via this endpoint. They render into
    // the review body and produce no submission_comments rows.
    const { sessions, findings, submissions, submissionComments } = setup()
    findings.insertManual('s1', {
      severity: 'should',
      category: 'Correctness',
      file: 'foo.ts',
      title: 'file-level one',
      body: 'first manual file-level note',
    })
    findings.insertManual('s1', {
      severity: 'nit',
      category: 'Style',
      file: 'foo.ts',
      title: 'file-level two',
      body: 'second manual file-level note',
    })
    let received: ReviewPayload | null = null
    const gh = ghStub({ onSubmit: (p) => (received = p), reviewId: 7000 })
    await submitSession({
      sessionId: 's1',
      event: 'COMMENT',
      sessions,
      findings,
      submissions,
      submissionComments,
      gh,
    })
    expect(received!.comments).toHaveLength(0)
    expect(received!.body).toContain('file-level one')
    expect(received!.body).toContain('file-level two')
    expect(submissionComments.listByPR('o', 'r', 1)).toHaveLength(0)
  })

  it('dedups against prior posted comments on the same PR', async () => {
    const { sessions, findings, submissions, submissionComments } = setup()
    // Seed a prior session + submission + posted comment for the same PR.
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
      workdir: '/w-prior',
      localRepoPath: null,
      promptUsed: 'p',
    })
    const priorSubId = submissions.insert({
      sessionId: 'prior',
      event: 'COMMENT',
      githubUrl: 'https://gh/prior',
      githubReviewId: 100,
      payloadJson: '{}',
      findingIds: [],
      error: null,
    })
    submissionComments.insertMany(priorSubId, [
      {
        findingDbId: null,
        githubCommentId: 8000,
        file: 'foo.ts',
        line: 11,
        startLine: null,
        title: 'duplicate title we will hit again',
        body: '🔴 **[must]** duplicate title we will hit again\n\nbody',
      },
    ])
    // New session proposes the same problem at the same line.
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'foo.ts',
        line: 11,
        title: 'duplicate title we will hit again',
        body: 'body',
      },
    ])
    let received: ReviewPayload | null = null
    const gh = ghStub({ onSubmit: (p) => (received = p) })
    const out = await submitSession({
      sessionId: 's1',
      event: 'COMMENT',
      sessions,
      findings,
      submissions,
      submissionComments,
      gh,
    })
    expect(out.skippedDuplicates).toBe(1)
    expect(received!.comments).toHaveLength(0)
  })
})
