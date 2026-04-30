import type { SessionsRepo } from './db/sessions'
import type { Logger } from './logger'

const DAY_MS = 86_400_000

export interface GCSessionsDeps {
  sessions: SessionsRepo
  deleteSession: (id: string) => Promise<void>
  perPRGCDays: number
  log: Logger
  now?: () => number
}

export interface GCResult {
  deleted: string[]
  skipped: number
}

export type GCSessionsFn = () => Promise<GCResult>

export function makeGCSessions(deps: GCSessionsDeps): GCSessionsFn {
  return async function gcSessions() {
    if (deps.perPRGCDays <= 0) return { deleted: [], skipped: 0 }

    const now = (deps.now ?? Date.now)()
    const cutoff = now - deps.perPRGCDays * DAY_MS

    const deleted: string[] = []
    let skipped = 0
    for (const s of deps.sessions.list()) {
      if (s.status === 'running' || s.status === 'pending') {
        skipped++
        continue
      }
      if (s.updatedAt >= cutoff) {
        skipped++
        continue
      }
      try {
        await deps.deleteSession(s.id)
        deleted.push(s.id)
        deps.log.info('gc deleted session', {
          id: s.id,
          owner: s.owner,
          repo: s.repo,
          number: s.number,
          ageDays: Math.floor((now - s.updatedAt) / DAY_MS),
        })
      } catch (e) {
        deps.log.warn('gc failed', { id: s.id, error: (e as Error).message })
      }
    }
    return { deleted, skipped }
  }
}
