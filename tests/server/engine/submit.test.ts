import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { FindingsRepo } from '../../../src/server/db/findings'
import { SessionsRepo } from '../../../src/server/db/sessions'
import { SubmissionsRepo } from '../../../src/server/db/submissions'
import { submitSession } from '../../../src/server/engine/submit'
import type { GhClient, ReviewPayload } from '../../../src/server/github/gh-client'
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
  return { sessions, findings, submissions }
}

describe('submitSession', () => {
  it('calls gh, records submission, returns URL + dropped', async () => {
    const { sessions, findings, submissions } = setup()
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
    const gh = {
      submitReview: async (_t: PRTarget, p: ReviewPayload) => {
        received = p
        return { html_url: 'https://gh', id: 1 }
      },
    } as unknown as GhClient
    const out = await submitSession({
      sessionId: 's1',
      event: 'COMMENT',
      sessions,
      findings,
      submissions,
      gh,
    })
    expect(out.url).toBe('https://gh')
    expect(out.droppedToBody).toHaveLength(1)
    expect(received).not.toBeNull()
    expect(received!.comments).toHaveLength(1)
    expect(submissions.listBySession('s1')).toHaveLength(1)
    expect(sessions.getById('s1')!.status).toBe('submitted')
  })

  it('only includes selected findings', async () => {
    const { sessions, findings, submissions } = setup()
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
    const gh = {
      submitReview: async (_t: PRTarget, p: ReviewPayload) => {
        received = p
        return { html_url: 'https://gh', id: 1 }
      },
    } as unknown as GhClient
    await submitSession({
      sessionId: 's1',
      event: 'COMMENT',
      sessions,
      findings,
      submissions,
      gh,
    })
    expect(received!.comments).toHaveLength(1)
    expect(received!.comments[0]!.body).toContain('t1')
  })

  it('records error submission and rethrows on gh failure', async () => {
    const { sessions, findings, submissions } = setup()
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
    const gh = {
      submitReview: async () => {
        throw new Error('boom')
      },
    } as unknown as GhClient
    await expect(
      submitSession({
        sessionId: 's1',
        event: 'COMMENT',
        sessions,
        findings,
        submissions,
        gh,
      }),
    ).rejects.toThrow('boom')
    const subs = submissions.listBySession('s1')
    expect(subs).toHaveLength(1)
    expect(subs[0]!.error).toBe('boom')
    expect(subs[0]!.githubUrl).toBeNull()
  })
})
