import type { SessionsRepo } from './db/sessions'
import type { EventBus } from './engine/events'
import type { ConcurrencyQueue } from './engine/queue'
import type { RunnerRegistry } from './engine/runner-registry'

export interface CancelSessionDeps {
  sessions: SessionsRepo
  queue: ConcurrencyQueue
  runners: RunnerRegistry
  bus: EventBus
}

export type CancelSessionFn = (id: string) => Promise<void>

export class SessionNotFoundError extends Error {
  constructor() {
    super('not found')
    this.name = 'SessionNotFoundError'
  }
}
export class SessionNotRunningError extends Error {
  constructor() {
    super('not running')
    this.name = 'SessionNotRunningError'
  }
}

export function makeCancelSession(deps: CancelSessionDeps): CancelSessionFn {
  return async function cancelSession(id) {
    const s = deps.sessions.getById(id)
    if (!s) throw new SessionNotFoundError()
    if (s.status !== 'running') throw new SessionNotRunningError()

    deps.queue.drop(id)
    await deps.runners.cancel(id)

    // If the runner had been registered it now writes 'cancelled' itself in
    // its terminal block; if the session was only queued (runner never spawned)
    // nothing wrote a terminal status, so we set it here.
    const after = deps.sessions.getById(id)
    if (after && after.status === 'running') {
      deps.sessions.setStatus(id, 'cancelled')
      deps.bus.emit({ type: 'status-changed', sessionId: id, status: 'cancelled' })
      deps.bus.emit({ type: 'done', sessionId: id })
    }
  }
}
