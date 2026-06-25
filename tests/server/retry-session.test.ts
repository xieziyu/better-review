import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { openDatabase } from '../../src/server/db/connection'
import { FindingsRepo } from '../../src/server/db/findings'
import { SessionsRepo } from '../../src/server/db/sessions'
import { makeRetrySession } from '../../src/server/retry-session'
import type { StartSessionDeps } from '../../src/server/start-session'
import type { SSEEvent } from '../../src/shared/types'

// Builds deps whose queue captures (but never executes) the pipeline callback,
// so these tests exercise only retrySession's synchronous prefix:
// guard → resolveAgent → status flip → enqueue. The heavy runSessionPipeline is
// covered by the runner + start-session integration tests.
function makeFixture(opts: { resolveAgentThrows?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'br-retry-'))
  const db = openDatabase(join(dir, 's.db'))
  const sessions = new SessionsRepo(db)
  const findings = new FindingsRepo(db)
  const events: SSEEvent[] = []
  const enqueued: string[] = []
  const deps = {
    sessions,
    findings,
    submissions: {} as StartSessionDeps['submissions'],
    submissionComments: {} as StartSessionDeps['submissionComments'],
    gh: {} as StartSessionDeps['gh'],
    bus: { emit: (e: SSEEvent) => events.push(e) } as unknown as StartSessionDeps['bus'],
    queue: {
      run: (id: string) => {
        enqueued.push(id)
        return Promise.resolve()
      },
    } as unknown as StartSessionDeps['queue'],
    runners: {} as StartSessionDeps['runners'],
    getConfig: () => ({ stallMinutes: 1 }) as ReturnType<StartSessionDeps['getConfig']>,
    paths: { home: dir, sessionsDir: dir, codexHome: dir },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    resolveAgent: vi.fn(() => {
      if (opts.resolveAgentThrows) throw new Error('Claude CLI not found in PATH')
      return { agent: {}, executable: '/fake/agent' } as ReturnType<
        StartSessionDeps['resolveAgent']
      >
    }),
  } as unknown as StartSessionDeps
  return { deps, sessions, findings, events, enqueued }
}

function insertFailed(sessions: SessionsRepo, id: string): void {
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
    localRepoPath: null,
    promptUsed: 'p',
  })
  sessions.setError(id, 'boom: gh rate limited')
  sessions.setStatus(id, 'failed')
}

describe('makeRetrySession', () => {
  it('throws "not found" for an unknown id', async () => {
    const { deps } = makeFixture()
    await expect(makeRetrySession(deps)('missing')).rejects.toThrow('not found')
  })

  it('throws "not failed" for a session that is not in the failed state', async () => {
    const { deps, sessions } = makeFixture()
    insertFailed(sessions, 's1')
    sessions.setStatus('s1', 'ready')
    await expect(makeRetrySession(deps)('s1')).rejects.toThrow('not failed')
  })

  it('clears the error, flips to pending, enqueues, and keeps the same id', async () => {
    const { deps, sessions, events, enqueued } = makeFixture()
    insertFailed(sessions, 's1')

    const result = await makeRetrySession(deps)('s1')

    expect(result).toEqual({ id: 's1' })
    const got = sessions.getById('s1')!
    expect(got.status).toBe('pending')
    expect(got.error).toBeNull()
    expect(enqueued).toEqual(['s1'])
    expect(events.some((e) => e.type === 'status-changed' && e.status === 'pending')).toBe(true)
  })

  it('keeps already-collected findings (does not archive or clear them)', async () => {
    const { deps, sessions, findings } = makeFixture()
    insertFailed(sessions, 's1')
    findings.insertMany('s1', [
      { id: 'F1', severity: 'must', category: 'x', file: null, line: null, title: 't', body: 'b' },
    ])

    await makeRetrySession(deps)('s1')

    expect(findings.listBySession('s1')).toHaveLength(1)
  })

  it('surfaces a missing-agent error synchronously and does not flip status', async () => {
    const { deps, sessions, enqueued } = makeFixture({ resolveAgentThrows: true })
    insertFailed(sessions, 's1')

    await expect(makeRetrySession(deps)('s1')).rejects.toThrow(/not found in PATH/)
    // The failed row is untouched — no half-applied retry.
    expect(sessions.getById('s1')!.status).toBe('failed')
    expect(enqueued).toEqual([])
  })
})
