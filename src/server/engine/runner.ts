import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { FindingsRepo } from '../db/findings'
import type { SessionsRepo } from '../db/sessions'
import type { ReviewAgent } from './agent'
import type { EventBus } from './events'
import { watchFindings } from './findings-watcher'

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
}

export async function runReview(args: RunReviewArgs): Promise<void> {
  const { sessionId, workdir, prompt, agent, executable, sessions, findings, bus, stallMs } = args
  mkdirSync(workdir, { recursive: true })
  const findingsPath = join(workdir, 'findings.json')
  const logPath = join(workdir, 'agent.log')
  writeFileSync(join(workdir, 'prompt.txt'), prompt)

  const seenIds = new Set<string>()
  const stopWatcher = await watchFindings(findingsPath, (result) => {
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

  let lastEventAt = Date.now()
  let killed = false
  let resultOk: boolean | null = null
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
      const evt: { type: 'progress'; sessionId: string; phase: string; detail?: string } = {
        type: 'progress',
        sessionId,
        phase,
      }
      if (detail !== undefined) evt.detail = detail
      bus.emit(evt)
    },
    onResult: (info) => {
      if (resultOk !== null) return
      resultOk = info.ok
      reapAfterResult()
    },
  })

  const watchdog = setInterval(
    () => {
      if (resultOk !== null) return
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

  const exitCode: number = await new Promise((res) => child.once('close', (code) => res(code ?? 0)))
  clearInterval(watchdog)
  await drained
  await new Promise((res) => setTimeout(res, 200))
  await stopWatcher()

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
}
