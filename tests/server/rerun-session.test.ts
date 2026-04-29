import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { openDatabase } from '../../src/server/db/connection'
import { FindingsRepo } from '../../src/server/db/findings'
import { SessionsRepo } from '../../src/server/db/sessions'
import { makeRerunSession } from '../../src/server/rerun-session'
import type { StartSessionFn } from '../../src/server/start-session'

function makeRepos(): { sessions: SessionsRepo; findings: FindingsRepo } {
  const dir = mkdtempSync(join(tmpdir(), 'br-rerun-'))
  const db = openDatabase(join(dir, 's.db'))
  return { sessions: new SessionsRepo(db), findings: new FindingsRepo(db) }
}

function insertSubmitted(sessions: SessionsRepo, id: string): void {
  sessions.insert({
    id,
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
    promptUsed: 'p',
  })
  sessions.setStatus(id, 'submitted')
}

describe('makeRerunSession', () => {
  it('archives the existing session so startSession creates a fresh one', async () => {
    const { sessions, findings } = makeRepos()
    insertSubmitted(sessions, 's1')

    const startSession = vi.fn<StartSessionFn>(async () => ({ id: 'fresh-id' }))
    const rerun = makeRerunSession({ sessions, findings, startSession })

    const result = await rerun('s1')

    expect(result.freshId).toBe('fresh-id')
    expect(startSession).toHaveBeenCalledWith({ prInput: 'o/r#1', agent: 'claude' })
    expect(sessions.getById('s1')?.status).toBe('archived')
  })

  it('archives all findings for the original session', async () => {
    const { sessions, findings } = makeRepos()
    insertSubmitted(sessions, 's1')
    findings.insertMany('s1', [
      { id: 'F1', severity: 'must', category: 'x', file: null, line: null, title: 't', body: 'b' },
    ])

    const rerun = makeRerunSession({
      sessions,
      findings,
      startSession: async () => ({ id: 'fresh-id' }),
    })
    await rerun('s1')

    expect(findings.listBySession('s1')).toHaveLength(0)
    expect(findings.listBySession('s1', { includeArchived: true })).toHaveLength(1)
  })

  it('throws when session id is unknown', async () => {
    const { sessions, findings } = makeRepos()
    const rerun = makeRerunSession({
      sessions,
      findings,
      startSession: async () => ({ id: 'x' }),
    })
    await expect(rerun('missing')).rejects.toThrow('not found')
  })
})
