import { SessionNotFoundError } from './session-errors'
import { runSessionPipeline, type StartSessionDeps } from './start-session'

// Re-enters a `failed` session in place: same id, same workdir, frozen at the
// same PR state. Unlike rerun (which archives the old session and starts a
// fresh one that re-resolves the PR's current head), retry reuses whatever prep
// artifacts already succeeded and resumes from the failure — for transient
// network / gh / agent failures the user wants to try the same review again,
// not review newer commits.
//
// Findings collected before the failure are deliberately kept: the runner seeds
// its cross-run dedup from them so the resumed agent re-emitting the same
// findings does not double-insert, and genuinely new findings are appended.
export type RetrySessionFn = (id: string) => Promise<{ id: string }>

export function makeRetrySession(deps: StartSessionDeps): RetrySessionFn {
  return async function retrySession(id) {
    const session = deps.sessions.getById(id)
    if (!session) throw new SessionNotFoundError()
    // Only a failed run is resumable. running/ready/submitted/archived/pending
    // each have their own lifecycle; retrying them would race a live run or
    // mutate a frozen historical snapshot.
    if (session.status !== 'failed') throw new Error('not failed')

    // Re-resolve the agent CLI now (it may have been installed since the
    // failure, or removed). Throwing here surfaces synchronously to the caller,
    // matching startSession — no pending row that will instantly re-fail.
    const resolvedAgent = deps.resolveAgent(session.agent)

    deps.sessions.setError(id, null)
    deps.sessions.setStatus(id, 'pending')
    deps.bus.emit({ type: 'status-changed', sessionId: id, status: 'pending' })

    void deps.queue.run(id, () => {
      // Re-read after the status flip so the pipeline sees the latest row.
      const fresh = deps.sessions.getById(id)
      if (!fresh) return Promise.resolve()
      return runSessionPipeline({ deps, session: fresh, resolvedAgent, resume: true })
    })
    return { id }
  }
}
