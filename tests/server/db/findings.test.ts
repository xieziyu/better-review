import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { FindingsRepo } from '../../../src/server/db/findings'
import { SessionsRepo } from '../../../src/server/db/sessions'
import { SubmissionCommentsRepo } from '../../../src/server/db/submission-comments'
import { SubmissionsRepo } from '../../../src/server/db/submissions'

describe('FindingsRepo', () => {
  let findings: FindingsRepo
  let submissions: SubmissionsRepo
  let submissionComments: SubmissionCommentsRepo
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-find-'))
    const db = openDatabase(join(dir, 'f.db'))
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
      status: 'running',
      agent: 'claude',
      workdir: '/w',
      localRepoPath: null,
      promptUsed: 'p',
    })
    findings = new FindingsRepo(db)
    submissions = new SubmissionsRepo(db)
    submissionComments = new SubmissionCommentsRepo(db)
  })

  it('insertMany + listBySession (active only)', () => {
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'Security',
        file: 'a.ts',
        line: 1,
        title: 't1',
        body: 'b1',
      },
      {
        id: 'R2',
        severity: 'nit',
        category: 'Naming',
        file: null,
        line: null,
        title: 't2',
        body: 'b2',
      },
    ])
    const list = findings.listBySession('s1', { includeArchived: false })
    expect(list).toHaveLength(2)
    expect(list[0]!.ord).toBe(1)
    expect(list[1]!.ord).toBe(2)
    expect(list[0]!.selected).toBe(true)
  })

  it('setSelected toggles flag', () => {
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: null,
        line: null,
        title: 't',
        body: 'b',
      },
    ])
    const f = findings.listBySession('s1')[0]!
    findings.setSelected(f.dbId, false)
    expect(findings.getById(f.dbId)!.selected).toBe(false)
  })

  it('update strips suggestion when the resulting finding is file-level (line=null)', () => {
    // File-level findings render into the review body where a fenced
    // `suggestion` block isn't actionable. The repo enforces this at the
    // boundary so direct PATCH hits can't smuggle one in around the form.
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'foo.ts',
        line: null,
        title: 't',
        body: 'b',
      },
    ])
    const f = findings.listBySession('s1')[0]!
    findings.update(f.dbId, { suggestion: 'fixed = 1' })
    expect(findings.getById(f.dbId)!.suggestion).toBeUndefined()
  })

  it('update keeps suggestion when the finding has a line anchor', () => {
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'foo.ts',
        line: 12,
        title: 't',
        body: 'b',
      },
    ])
    const f = findings.listBySession('s1')[0]!
    findings.update(f.dbId, { suggestion: 'fixed = 1' })
    expect(findings.getById(f.dbId)!.suggestion).toBe('fixed = 1')
  })

  it('update sets edited=true', () => {
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: null,
        line: null,
        title: 't',
        body: 'b',
      },
    ])
    const f = findings.listBySession('s1')[0]!
    findings.update(f.dbId, { title: 'new' })
    const got = findings.getById(f.dbId)!
    expect(got.title).toBe('new')
    expect(got.edited).toBe(true)
  })

  it('listBySession exposes submittedAt and submittedCommentId from joined submissions', () => {
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'a.ts',
        line: 5,
        title: 'with-comment',
        body: 'b',
      },
      {
        id: 'R2',
        severity: 'should',
        category: 'x',
        file: 'b.ts',
        line: 10,
        title: 'drop-to-body',
        body: 'b',
      },
      {
        id: 'R3',
        severity: 'nit',
        category: 'x',
        file: 'c.ts',
        line: 1,
        title: 'never-submitted',
        body: 'b',
      },
    ])
    const initial = findings.listBySession('s1')
    const [f1, f2, f3] = initial
    expect(f1!.submittedAt).toBeNull()
    expect(f1!.submittedCommentId).toBeNull()
    // f1 + f2 both go into a submission; only f1 gets an inline comment row.
    const subId = submissions.insert({
      sessionId: 's1',
      event: 'COMMENT',
      githubUrl: 'https://example/x',
      githubReviewId: 42,
      payloadJson: '{}',
      findingIds: [f1!.dbId, f2!.dbId],
      error: null,
    })
    submissionComments.insertMany(subId, [
      {
        findingDbId: f1!.dbId,
        githubCommentId: 9001,
        file: 'a.ts',
        line: 5,
        startLine: null,
        title: 'with-comment',
        body: 'body',
      },
    ])
    const after = findings.listBySession('s1')
    expect(after[0]!.submittedAt).not.toBeNull()
    expect(after[0]!.submittedCommentId).toBe(9001)
    expect(after[1]!.submittedAt).not.toBeNull()
    expect(after[1]!.submittedCommentId).toBeNull()
    expect(after[2]!.submittedAt).toBeNull()
    expect(after[2]!.submittedCommentId).toBeNull()
    expect(findings.getById(f1!.dbId)!.submittedCommentId).toBe(9001)
  })

  it('listBySession ignores error submissions when computing submittedAt', () => {
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'a.ts',
        line: 5,
        title: 't',
        body: 'b',
      },
    ])
    const f = findings.listBySession('s1')[0]!
    submissions.insert({
      sessionId: 's1',
      event: 'COMMENT',
      githubUrl: null,
      githubReviewId: null,
      payloadJson: '{}',
      findingIds: [f.dbId],
      error: 'boom',
    })
    expect(findings.getById(f.dbId)!.submittedAt).toBeNull()
  })

  it('archiveAllForSession excludes from active list', () => {
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: null,
        line: null,
        title: 't',
        body: 'b',
      },
    ])
    findings.archiveAllForSession('s1')
    expect(findings.listBySession('s1')).toHaveLength(0)
    expect(findings.listBySession('s1', { includeArchived: true })).toHaveLength(1)
  })
})
