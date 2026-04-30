import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

import type Database from 'better-sqlite3'

import type { SessionsRepo } from './db/sessions'
import type { SubmissionsRepo } from './db/submissions'
import type { ConcurrencyQueue } from './engine/queue'
import type { RunnerRegistry } from './engine/runner-registry'

export interface DeleteSessionDeps {
  db: Database.Database
  sessions: SessionsRepo
  submissions: SubmissionsRepo
  queue: ConcurrencyQueue
  runners: RunnerRegistry
  sessionsDir: string
}

export type DeleteSessionFn = (id: string) => Promise<void>

export class SessionNotFoundError extends Error {
  constructor() {
    super('not found')
    this.name = 'SessionNotFoundError'
  }
}

export function makeDeleteSession(deps: DeleteSessionDeps): DeleteSessionFn {
  const safeRoot = resolve(deps.sessionsDir)
  const removeFromDb = deps.db.transaction((id: string) => {
    deps.submissions.deleteBySession(id)
    deps.sessions.delete(id)
  })

  return async function deleteSession(id) {
    const session = deps.sessions.getById(id)
    if (!session) throw new SessionNotFoundError()

    await deps.runners.cancel(id)
    deps.queue.drop(id)

    removeFromDb(id)

    const workdir = resolve(session.workdir)
    if (workdir.startsWith(safeRoot + '/') && workdir !== safeRoot) {
      rmSync(workdir, { recursive: true, force: true })
    }
  }
}
