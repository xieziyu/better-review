import type { AgentKind } from '../shared/types'
import type { FindingsRepo } from './db/findings'
import type { SessionsRepo } from './db/sessions'
import type { StartSessionFn } from './start-session'

export interface RerunSessionDeps {
  sessions: SessionsRepo
  findings: FindingsRepo
  startSession: StartSessionFn
}

export interface RerunSessionOptions {
  agent?: AgentKind
  // When omitted, the rerun reuses the previous session's `extraPrompt`.
  // When provided (including the empty string), it overrides — the empty
  // string clears the carry-over.
  extraPrompt?: string
}

export type RerunSessionFn = (
  id: string,
  opts?: RerunSessionOptions,
) => Promise<{ freshId: string }>

export function makeRerunSession(deps: RerunSessionDeps): RerunSessionFn {
  return async function rerunSession(id, opts) {
    const s = deps.sessions.getById(id)
    if (!s) throw new Error('not found')
    // Re-running an already-archived round would double-archive its findings
    // and reset the chain pointer; the user wants to rerun from the current
    // (non-archived) head, not a frozen historical snapshot.
    if (s.status === 'archived') throw new Error('already archived')
    deps.findings.archiveAllForSession(id)
    deps.sessions.setStatus(id, 'archived')
    const startInput: {
      prInput: string
      agent: AgentKind
      localRepoPath?: string
      extraPrompt?: string
    } = {
      prInput: `https://github.com/${s.owner}/${s.repo}/pull/${s.number}`,
      agent: opts?.agent ?? s.agent,
    }
    if (s.localRepoPath !== null) startInput.localRepoPath = s.localRepoPath
    const carryOver = opts?.extraPrompt !== undefined ? opts.extraPrompt : (s.extraPrompt ?? '')
    if (carryOver.trim().length > 0) startInput.extraPrompt = carryOver
    const fresh = await deps.startSession(startInput)
    return { freshId: fresh.id }
  }
}
