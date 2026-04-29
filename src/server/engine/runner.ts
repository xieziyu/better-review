import { spawn } from 'node:child_process'
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { FindingsRepo } from '../db/findings'
import type { SessionsRepo } from '../db/sessions'
import type { EventBus } from './events'
import { watchFindings } from './findings-watcher'
import { parseStreamJson } from './stream-json'

export interface RunReviewArgs {
  sessionId: string
  workdir: string
  prompt: string
  claudePath: string
  sessions: SessionsRepo
  findings: FindingsRepo
  bus: EventBus
  stallMs: number
}

export async function runReview(args: RunReviewArgs): Promise<void> {
  const { sessionId, workdir, prompt, claudePath, sessions, findings, bus, stallMs } = args
  mkdirSync(workdir, { recursive: true })
  const findingsPath = join(workdir, 'findings.json')
  const logPath = join(workdir, 'claude.log')
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

  const child = spawn(claudePath, ['--output-format', 'stream-json', '--verbose', '-p', prompt], {
    cwd: workdir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let lastEventAt = Date.now()
  let killed = false
  const watchdog = setInterval(
    () => {
      if (Date.now() - lastEventAt > stallMs) {
        if (!killed) {
          killed = true
          bus.emit({ type: 'error', sessionId, message: 'claude stalled — killing' })
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

  const stdoutPromise = parseStreamJson(
    child.stdout!,
    (e) => {
      lastEventAt = Date.now()
      bus.emit({
        type: 'progress',
        sessionId,
        phase: e.type,
        detail: JSON.stringify(e).slice(0, 200),
      })
      appendFileSync(logPath, JSON.stringify(e) + '\n')
    },
    (err) => appendFileSync(logPath, `[stream-json error] ${err}\n`),
  )

  child.stderr?.on('data', (chunk) => appendFileSync(logPath, chunk))

  const exitCode: number = await new Promise((res) => child.once('close', (code) => res(code ?? 0)))
  clearInterval(watchdog)
  await stdoutPromise
  await new Promise((res) => setTimeout(res, 200))
  await stopWatcher()

  if (exitCode === 0 && !killed) {
    sessions.setStatus(sessionId, 'ready')
    bus.emit({ type: 'status-changed', sessionId, status: 'ready' })
    bus.emit({ type: 'done', sessionId })
  } else {
    const msg = killed ? 'claude stalled' : `claude exited ${exitCode}`
    sessions.setError(sessionId, msg)
    sessions.setStatus(sessionId, 'failed')
    bus.emit({ type: 'status-changed', sessionId, status: 'failed', error: msg })
    bus.emit({ type: 'error', sessionId, message: msg })
  }
}
