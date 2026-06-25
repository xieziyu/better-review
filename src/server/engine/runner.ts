import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { FindingsRepo } from '../db/findings'
import type { SessionsRepo } from '../db/sessions'
import type { ReviewAgent } from './agent'
import type { EventBus } from './events'
import { watchFindings } from './findings-watcher'
import type { RunnerRegistry } from './runner-registry'
import { watchSummary } from './summary-watcher'

// Content identity of a finding, shared by agent-emitted findings and persisted
// rows. Used for cross-run dedup on retry (see runReview). JSON-encoding the
// tuple keeps distinct fields from colliding without embedding control chars.
function findingKey(f: { file: string | null; line: number | null; title: string }): string {
  return JSON.stringify([f.file, f.line, f.title])
}

export interface RunReviewArgs {
  sessionId: string
  workdir: string
  // Source tree at PR head — full worktree or partial snapshot. Forwarded to
  // the agent so it can read post-merge files; omitted in diff-only mode.
  sourcePath?: string
  // Forwarded verbatim to the agent's spawn args. Codex consumes this as its
  // CODEX_HOME; other agents ignore it. See engine/agent/codex-home.ts.
  codexHome?: string
  prompt: string
  agent: ReviewAgent
  executable: string
  sessions: SessionsRepo
  findings: FindingsRepo
  bus: EventBus
  stallMs: number
  runners: RunnerRegistry
}

export async function runReview(args: RunReviewArgs): Promise<void> {
  const {
    sessionId,
    workdir,
    sourcePath,
    codexHome,
    prompt,
    agent,
    executable,
    sessions,
    findings,
    bus,
    stallMs,
    runners,
  } = args
  mkdirSync(workdir, { recursive: true })
  const findingsPath = join(workdir, 'findings.json')
  const summaryPath = join(workdir, 'summary.json')
  const logPath = join(workdir, 'agent.log')
  writeFileSync(join(workdir, 'prompt.txt'), prompt)

  let lastEventAt = Date.now()
  let killed = false
  let cancelled = false
  let resultOk: boolean | null = null

  const seenIds = new Set<string>()
  // Cross-run dedup, keyed by content (file|line|title) because the agent's own
  // `id` values are not persisted. Seeded from findings already ingested for
  // this session so a retry — which re-runs the agent over the leftover
  // findings.json and re-emits the prior run's findings — does not double-insert
  // them. Empty for a fresh run, so behavior there is unchanged.
  const seenKeys = new Set<string>(findings.listBySession(sessionId).map(findingKey))
  const stopWatcher = await watchFindings(findingsPath, (result) => {
    if (cancelled) return
    if (!result.ok) {
      bus.emit({ type: 'error', sessionId, message: result.error })
      return
    }
    if (result.skipped.length > 0) {
      const detail = result.skipped.map((s) => `[${s.index}] ${s.error}`).join('; ')
      bus.emit({
        type: 'error',
        sessionId,
        message: `findings.json: skipped ${result.skipped.length} invalid finding(s): ${detail}`,
      })
    }
    const fresh = result.data.filter((f) => !seenIds.has(f.id) && !seenKeys.has(findingKey(f)))
    if (fresh.length === 0) return
    fresh.forEach((f) => {
      seenIds.add(f.id)
      seenKeys.add(findingKey(f))
    })
    const inserted = findings.insertMany(sessionId, fresh)
    inserted.forEach((f) => bus.emit({ type: 'finding-added', sessionId, finding: f }))
  })
  // The agent's review summary is best-effort: a parse failure surfaces as a
  // non-fatal `error` event and leaves the session's summary null (the Summary
  // tab degrades to its derived stats + coverage).
  const stopSummaryWatcher = await watchSummary(summaryPath, (result) => {
    if (cancelled) return
    if (!result.ok) {
      bus.emit({ type: 'error', sessionId, message: `summary.json: ${result.error}` })
      return
    }
    sessions.setSummary(sessionId, result.data)
    bus.emit({ type: 'summary-generated', sessionId, summary: result.data })
  })
  const reapAfterResult = () => {
    child.kill('SIGTERM')
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* may already be dead */
      }
    }, 2_000)
  }
  const spawnArgs: Parameters<typeof agent.spawn>[0] = {
    executable,
    prompt,
    workdir,
    logPath,
    onProgress: (phase, detail) => {
      lastEventAt = Date.now()
      if (cancelled) return
      const evt: { type: 'progress'; sessionId: string; phase: string; detail?: string } = {
        type: 'progress',
        sessionId,
        phase,
      }
      if (detail !== undefined) evt.detail = detail
      bus.emit(evt)
    },
    onOutput: (chunk) => {
      if (cancelled) return
      if (!chunk) return
      bus.emit({ type: 'agent-output', sessionId, chunk, ts: Date.now() })
    },
    onResult: (info) => {
      if (resultOk !== null) return
      resultOk = info.ok
      reapAfterResult()
    },
  }
  if (sourcePath !== undefined) spawnArgs.sourcePath = sourcePath
  if (codexHome !== undefined) spawnArgs.codexHome = codexHome

  // Flip status pending → running and announce the agent boundary just before
  // spawn. The synthetic `agent:starting` event is the first non-`prep:`
  // phase the UI sees, so RunStrip can swap its "Prep" label for "Reviewing"
  // exactly when the child process actually starts.
  sessions.setStatus(sessionId, 'running')
  bus.emit({ type: 'status-changed', sessionId, status: 'running' })
  bus.emit({
    type: 'progress',
    sessionId,
    phase: 'agent:starting',
    detail: agent.displayName,
  })

  const { child, drained } = agent.spawn(spawnArgs)

  runners.register(sessionId, async () => {
    cancelled = true
    child.kill('SIGTERM')
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* may already be dead */
      }
    }, 2_000)
    await new Promise((res) => child.once('close', res))
  })

  const watchdog = setInterval(
    () => {
      if (cancelled || resultOk !== null) return
      if (Date.now() - lastEventAt > stallMs) {
        if (!killed) {
          killed = true
          bus.emit({
            type: 'error',
            sessionId,
            message: `${agent.displayName} stalled — killing`,
          })
          child.kill('SIGTERM')
          setTimeout(() => {
            try {
              child.kill('SIGKILL')
            } catch {
              /* may already be dead */
            }
          }, 2_000)
        }
      }
    },
    Math.min(stallMs, 5_000),
  )

  try {
    const exitCode: number = await new Promise((res) =>
      child.once('close', (code) => res(code ?? 0)),
    )
    clearInterval(watchdog)
    await drained
    await new Promise((res) => setTimeout(res, 200))
    await stopWatcher()
    await stopSummaryWatcher()

    if (cancelled) {
      sessions.setStatus(sessionId, 'cancelled')
      bus.emit({ type: 'status-changed', sessionId, status: 'cancelled' })
      bus.emit({ type: 'done', sessionId })
      return
    }

    const succeeded = resultOk === true || (resultOk === null && exitCode === 0 && !killed)
    if (succeeded) {
      sessions.setStatus(sessionId, 'ready')
      bus.emit({ type: 'status-changed', sessionId, status: 'ready' })
      bus.emit({ type: 'done', sessionId })
    } else {
      const msg =
        resultOk === false
          ? `${agent.displayName} reported error result`
          : killed
            ? `${agent.displayName} stalled`
            : `${agent.displayName} exited ${exitCode}`
      sessions.setError(sessionId, msg)
      sessions.setStatus(sessionId, 'failed')
      bus.emit({ type: 'status-changed', sessionId, status: 'failed', error: msg })
      bus.emit({ type: 'error', sessionId, message: msg })
    }
  } finally {
    clearInterval(watchdog)
    runners.unregister(sessionId)
  }
}
