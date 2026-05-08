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

function insertSubmitted(
  sessions: SessionsRepo,
  id: string,
  opts: { localRepoPath?: string | null } = {},
): void {
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
    localRepoPath: opts.localRepoPath ?? null,
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
    expect(startSession).toHaveBeenCalledWith({
      prInput: 'https://github.com/o/r/pull/1',
      agent: 'claude',
    })
    expect(sessions.getById('s1')?.status).toBe('archived')
  })

  it('forwards an explicit agent override to startSession', async () => {
    const { sessions, findings } = makeRepos()
    insertSubmitted(sessions, 's1')

    const startSession = vi.fn<StartSessionFn>(async () => ({ id: 'fresh-id' }))
    const rerun = makeRerunSession({ sessions, findings, startSession })

    await rerun('s1', 'codex')

    expect(startSession).toHaveBeenCalledWith({
      prInput: 'https://github.com/o/r/pull/1',
      agent: 'codex',
    })
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

  it('forwards localRepoPath from the original session to the fresh one', async () => {
    const { sessions, findings } = makeRepos()
    insertSubmitted(sessions, 's1', { localRepoPath: '/Users/me/code/r' })

    const startSession = vi.fn<StartSessionFn>(async () => ({ id: 'fresh-id' }))
    const rerun = makeRerunSession({ sessions, findings, startSession })
    await rerun('s1')

    expect(startSession).toHaveBeenCalledWith({
      prInput: 'https://github.com/o/r/pull/1',
      agent: 'claude',
      localRepoPath: '/Users/me/code/r',
    })
  })

  it('omits localRepoPath when the original session had none', async () => {
    const { sessions, findings } = makeRepos()
    insertSubmitted(sessions, 's1')

    const startSession = vi.fn<StartSessionFn>(async () => ({ id: 'fresh-id' }))
    const rerun = makeRerunSession({ sessions, findings, startSession })
    await rerun('s1')

    expect(startSession).toHaveBeenCalledWith({
      prInput: 'https://github.com/o/r/pull/1',
      agent: 'claude',
    })
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
