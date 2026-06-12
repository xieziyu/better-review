import type { AgentKind } from '../shared/types'
import type { FindingsRepo } from './db/findings'
import type { SessionsRepo } from './db/sessions'
import { SessionNotFoundError } from './session-errors'
import type { StartSessionFn, StartSessionInput } from './start-session'

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
    if (!s) throw new SessionNotFoundError()
    // Archived rounds are normally frozen historical snapshots, but a previous
    // rerun can leave an orphan: archiveAllForSession + setStatus('archived')
    // run before startSession, and startSession has synchronous failure modes
    // (missing agent CLI, vanished localRepoPath) that can throw after the
    // archive step but before the replacement session row is inserted. Allow
    // the user to rerun an orphaned archived head — but block rerun when a
    // live head for this PR already exists, which is the case the reviewer
    // actually wants prevented.
    if (s.status === 'archived' && s.source.kind === 'github-pr') {
      // Same-PR live-head guard. Local-branch sessions are not deduped
      // today (see start-session.ts), so this protection only applies
      // to the PR path.
      const liveHead = deps.sessions.findActiveByPR(s.source.owner, s.source.repo, s.source.number)
      if (liveHead && liveHead.id !== s.id) throw new Error('already archived')
    }
    deps.findings.archiveAllForSession(id)
    deps.sessions.setStatus(id, 'archived')

    // Replay the archived session's source verbatim — for local-branch
    // that means re-resolving HEAD/auto-base to whatever they point at
    // right now (the rerun reviews the current state, not last round's
    // snapshot). PR rerun stays bit-for-bit equivalent to the legacy
    // URL-reconstruction path.
    const startInput: StartSessionInput = {
      source: s.source,
      agent: opts?.agent ?? s.agent,
    }
    if (s.localRepoPath !== null) startInput.localRepoPath = s.localRepoPath
    const carryOver = opts?.extraPrompt !== undefined ? opts.extraPrompt : (s.extraPrompt ?? '')
    if (carryOver.trim().length > 0) startInput.extraPrompt = carryOver
    const fresh = await deps.startSession(startInput)
    return { freshId: fresh.id }
  }
}
