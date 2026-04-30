import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { FindingsRepo } from '../db/findings'
import type { SessionsRepo } from '../db/sessions'
import type { ReviewAgent } from './agent'
import type { EventBus } from './events'
import { watchFindings } from './findings-watcher'
import type { RunnerRegistry } from './runner-registry'

export interface RunReviewArgs {
  sessionId: string
  workdir: string
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
  const logPath = join(workdir, 'agent.log')
  writeFileSync(join(workdir, 'prompt.txt'), prompt)

  let lastEventAt = Date.now()
  let killed = false
  let cancelled = false
  let resultOk: boolean | null = null

  const seenIds = new Set<string>()
  const stopWatcher = await watchFindings(findingsPath, (result) => {
    if (cancelled) return
    if (!result.ok) {
      bus.emit({ type: 'error', sessionId, message: result.error })
      return
    }
    const fresh = result.data.filter((f) => !seenIds.has(f.id))
    if (fresh.length === 0) return
    fresh.forEach((f) => seenIds.add(f.id))
    const inserted = findings.insertMany(sessionId, fresh)
    inserted.forEach((f) => bus.emit({ type: 'finding-added', sessionId, finding: f }))
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
  const { child, drained } = agent.spawn({
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
  })

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

    if (cancelled) return

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
