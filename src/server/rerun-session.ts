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
    // Archived rounds are normally frozen historical snapshots, but a previous
    // rerun can leave an orphan: archiveAllForSession + setStatus('archived')
    // run before startSession, and startSession has synchronous failure modes
    // (missing agent CLI, vanished localRepoPath) that can throw after the
    // archive step but before the replacement session row is inserted. Allow
    // the user to rerun an orphaned archived head — but block rerun when a
    // live head for this PR already exists, which is the case the reviewer
    // actually wants prevented.
    if (s.status === 'archived') {
      const liveHead = deps.sessions.findActiveByPR(s.owner, s.repo, s.number)
      if (liveHead && liveHead.id !== s.id) throw new Error('already archived')
    }
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
