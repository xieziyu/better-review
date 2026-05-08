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
    const startInput: { prInput: string; agent: AgentKind; localRepoPath?: string } = {
      prInput: `https://github.com/${s.owner}/${s.repo}/pull/${s.number}`,
      agent: agent ?? s.agent,
    }
    if (s.localRepoPath !== null) startInput.localRepoPath = s.localRepoPath
    const fresh = await deps.startSession(startInput)
    return { freshId: fresh.id }
  }
}
