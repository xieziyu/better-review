import type { AgentKind } from '../shared/types'
import type { FindingsRepo } from './db/findings'
import type { SessionsRepo } from './db/sessions'
import type { StartSessionFn } from './start-session'

export interface RerunSessionDeps {
  sessions: SessionsRepo
  findings: FindingsRepo
  startSession: StartSessionFn
}

export type RerunSessionFn = (id: string, agent?: AgentKind) => Promise<{ freshId: string }>

export function makeRerunSession(deps: RerunSessionDeps): RerunSessionFn {
  return async function rerunSession(id, agent) {
    const s = deps.sessions.getById(id)
    if (!s) throw new Error('not found')
    deps.findings.archiveAllForSession(id)
    deps.sessions.setStatus(id, 'archived')
    const fresh = await deps.startSession({
      prInput: `${s.owner}/${s.repo}#${s.number}`,
      agent: agent ?? s.agent,
    })
    return { freshId: fresh.id }
  }
}
