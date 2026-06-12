import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { makeCancelSession } from '../../src/server/cancel-session'
import { openDatabase } from '../../src/server/db/connection'
import { SessionsRepo } from '../../src/server/db/sessions'
import { EventBus } from '../../src/server/engine/events'
import { ConcurrencyQueue } from '../../src/server/engine/queue'
import { RunnerRegistry } from '../../src/server/engine/runner-registry'
import { SessionNotFoundError, SessionNotRunningError } from '../../src/server/session-errors'
import type { SSEEvent } from '../../src/shared/types'

function setup() {
  const dbDir = mkdtempSync(join(tmpdir(), 'br-cancel-'))
  const db = openDatabase(join(dbDir, 's.db'))
  const sessions = new SessionsRepo(db)
  const queue = new ConcurrencyQueue(1)
  const runners = new RunnerRegistry()
  const bus = new EventBus()
  const cancelSession = makeCancelSession({ sessions, queue, runners, bus })
  return { sessions, queue, runners, bus, cancelSession }
}

function insertRunning(sessions: SessionsRepo, id: string): void {
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
}

describe('cancelSession', () => {
  it('throws SessionNotFoundError for unknown id', async () => {
    const { cancelSession } = setup()
    await expect(cancelSession('missing')).rejects.toBeInstanceOf(SessionNotFoundError)
  })

  it('throws SessionNotRunningError when session is not running', async () => {
    const { sessions, cancelSession } = setup()
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
      workdir: '/w',
      localRepoPath: null,
      promptUsed: 'p',
    })
    await expect(cancelSession('s1')).rejects.toBeInstanceOf(SessionNotRunningError)
  })

  it('writes cancelled status itself when runner never registered (queued case)', async () => {
    const { sessions, bus, cancelSession } = setup()
    insertRunning(sessions, 's1')
    const events: SSEEvent[] = []
    bus.subscribeGlobal((e) => events.push(e))

    await cancelSession('s1')

    expect(sessions.getById('s1')!.status).toBe('cancelled')
    expect(events.some((e) => e.type === 'status-changed' && e.status === 'cancelled')).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('runs registered runner cancel callback (does not double-write when runner already wrote terminal state)', async () => {
    const { sessions, runners, bus, cancelSession } = setup()
    insertRunning(sessions, 's1')

    let cancelCalled = false
    runners.register('s1', async () => {
      cancelCalled = true
      // simulate the runner's terminal write happening before cancel-session re-checks
      sessions.setStatus('s1', 'cancelled')
      bus.emit({ type: 'status-changed', sessionId: 's1', status: 'cancelled' })
      bus.emit({ type: 'done', sessionId: 's1' })
    })

    const events: SSEEvent[] = []
    bus.subscribeGlobal((e) => events.push(e))

    await cancelSession('s1')

    expect(cancelCalled).toBe(true)
    expect(sessions.getById('s1')!.status).toBe('cancelled')
    const cancelledEvents = events.filter(
      (e) => e.type === 'status-changed' && e.status === 'cancelled',
    )
    expect(cancelledEvents).toHaveLength(1)
    const doneEvents = events.filter((e) => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
  })

  it('drops session from queue', async () => {
    const { sessions, queue, cancelSession } = setup()
    // Fill queue to capacity (maxActive=1) with a long task so the next one queues.
    let releaseHead: () => void = () => {}
    void queue.run('head', () => new Promise<void>((res) => (releaseHead = res)))

    insertRunning(sessions, 's1')
    let queuedRan = false
    void queue.run('s1', async () => {
      queuedRan = true
    })
    expect(queue.pendingCount()).toBe(1)

    await cancelSession('s1')

    expect(queue.pendingCount()).toBe(0)
    expect(sessions.getById('s1')!.status).toBe('cancelled')

    releaseHead()
    await new Promise((r) => setTimeout(r, 10))
    expect(queuedRan).toBe(false)
  })
})
