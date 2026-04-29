import type { FindingsRepo } from './db/findings'
import type { SessionsRepo } from './db/sessions'
import type { StartSessionFn } from './start-session'

export interface RerunSessionDeps {
  sessions: SessionsRepo
  findings: FindingsRepo
  startSession: StartSessionFn
}

export type RerunSessionFn = (id: string) => Promise<{ freshId: string }>

export function makeRerunSession(deps: RerunSessionDeps): RerunSessionFn {
  return async function rerunSession(id) {
    const s = deps.sessions.getById(id)
    if (!s) throw new Error('not found')
    deps.findings.archiveAllForSession(id)
    deps.sessions.setStatus(id, 'archived')
    const fresh = await deps.startSession(`${s.owner}/${s.repo}#${s.number}`)
    return { freshId: fresh.id }
  }
}
