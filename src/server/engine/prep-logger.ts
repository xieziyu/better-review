import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PrepCall } from '../../shared/types'

import type { EventBus } from './events'

// ALS-scoped current phase. Used by the parallel prior-context / source-prep
// block in start-session.ts so each branch's gh calls get tagged with the
// right phase even though both branches run concurrently. Outside any
// `withCurrentPhase` wrapper, `recordCall` falls back to the most recently
// marked phase on the PrepLogger instance.
const currentPhaseStore = new AsyncLocalStorage<string>()

export function withCurrentPhase<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  return currentPhaseStore.run(phase, fn)
}

// 64 KB cap on stdout/stderr payloads attached to SSE events. prep.log keeps
// the full untruncated text for forensics; this limit only applies to what we
// push to subscribed clients. Hostile responses (a 5 MB issue body) would
// otherwise flood EventSource consumers.
const SSE_CAP_BYTES = 64 * 1024

interface PrepLogPhaseEntry {
  kind: 'phase'
  phase: string
  detail?: string
  ts: number
}

interface PrepLogCallEntry {
  kind: 'call'
  phase: string
  command: string[]
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  ts: number
}

export type PrepLogEntry = PrepLogPhaseEntry | PrepLogCallEntry

interface PrepLoggerDeps {
  workdir: string
  sessionId: string
  bus: EventBus
}

/**
 * Owns the per-session prep.log + SSE emission for prep-phase observability.
 * One instance per review session; lives inside the queue worker for the
 * duration of `prepareReview`. After prep ends the instance is dropped and
 * the file is read-only (replayed via the `/sessions/:id/prep-log` route on
 * refresh).
 *
 * `markPhase` is a drop-in replacement for the old direct
 * `bus.emit({type:'progress', phase})` calls in start-session.ts — it also
 * persists the marker so refresh during prep doesn't lose the phase timeline.
 * `recordCall` is invoked via the AsyncLocalStorage hook installed by
 * `withGhCallRecorder` in gh-client.ts.
 */
export class PrepLogger {
  private logPath: string
  private currentPhase: string | null = null

  constructor(private deps: PrepLoggerDeps) {
    this.logPath = join(deps.workdir, 'prep.log')
  }

  markPhase(phase: string, detail?: string): void {
    this.currentPhase = phase
    const entry: PrepLogPhaseEntry = { kind: 'phase', phase, ts: Date.now() }
    if (detail !== undefined) entry.detail = detail
    this.append(entry)
    this.deps.bus.emit({
      type: 'progress',
      sessionId: this.deps.sessionId,
      phase,
      ...(detail !== undefined ? { detail } : {}),
    })
  }

  /**
   * Record a gh call. `phase` may be passed explicitly (preferred — set by
   * `withCurrentPhase` ALS for the parallel prior-context / source-prep
   * block), otherwise falls back to the most recently marked phase.
   */
  recordCall(call: Omit<PrepCall, 'phase'> & { phase?: string }): void {
    const phase =
      call.phase ?? currentPhaseStore.getStore() ?? this.currentPhase ?? 'prep:unknown'
    const entry: PrepLogCallEntry = {
      kind: 'call',
      phase,
      command: call.command,
      stdout: call.stdout,
      stderr: call.stderr,
      exitCode: call.exitCode,
      durationMs: call.durationMs,
      ts: call.ts,
    }
    this.append(entry)
    this.deps.bus.emit({
      type: 'prep-output',
      sessionId: this.deps.sessionId,
      phase,
      command: entry.command,
      stdout: cap(entry.stdout),
      stderr: cap(entry.stderr),
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
      ts: entry.ts,
    })
  }

  private append(entry: PrepLogEntry): void {
    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n')
    } catch {
      // Best-effort persistence. A failed write must not break prep.
    }
  }
}

function cap(s: string): string {
  if (Buffer.byteLength(s, 'utf8') <= SSE_CAP_BYTES) return s
  return s.slice(0, SSE_CAP_BYTES) + `\n… [truncated, original ${s.length} chars]`
}
