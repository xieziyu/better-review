import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { SSEEvent } from '../../../src/shared/types'
import { EventBus } from '../../../src/server/engine/events'
import { PrepLogger, withCurrentPhase } from '../../../src/server/engine/prep-logger'

function makeLogger() {
  const workdir = mkdtempSync(join(tmpdir(), 'br-prep-'))
  const bus = new EventBus()
  const events: SSEEvent[] = []
  bus.subscribeGlobal((e) => events.push(e))
  const logger = new PrepLogger({ workdir, sessionId: 's1', bus })
  return { logger, workdir, events }
}

describe('PrepLogger', () => {
  it('markPhase persists a phase entry and emits the progress SSE event', () => {
    const { logger, workdir, events } = makeLogger()
    logger.markPhase('prep:fetching-pr')
    const log = readFileSync(join(workdir, 'prep.log'), 'utf8').trim().split('\n')
    expect(log).toHaveLength(1)
    const parsed = JSON.parse(log[0]!)
    expect(parsed).toMatchObject({ kind: 'phase', phase: 'prep:fetching-pr' })
    expect(typeof parsed.ts).toBe('number')
    expect(events.find((e) => e.type === 'progress')).toMatchObject({
      type: 'progress',
      sessionId: 's1',
      phase: 'prep:fetching-pr',
    })
  })

  it('recordCall persists a call entry tagged with the most recently marked phase', () => {
    const { logger, workdir, events } = makeLogger()
    logger.markPhase('prep:fetching-pr')
    logger.recordCall({
      command: ['gh', 'pr', 'view', '12'],
      stdout: '{"number":12}',
      stderr: '',
      exitCode: 0,
      durationMs: 42,
      ts: Date.now(),
    })
    const lines = readFileSync(join(workdir, 'prep.log'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    const call = JSON.parse(lines[1]!)
    expect(call).toMatchObject({
      kind: 'call',
      phase: 'prep:fetching-pr',
      command: ['gh', 'pr', 'view', '12'],
      stdout: '{"number":12}',
      exitCode: 0,
      durationMs: 42,
    })
    const sse = events.find((e) => e.type === 'prep-output')
    expect(sse).toMatchObject({
      type: 'prep-output',
      sessionId: 's1',
      phase: 'prep:fetching-pr',
      command: ['gh', 'pr', 'view', '12'],
    })
  })

  it('withCurrentPhase tag wins over the instance currentPhase for concurrent branches', async () => {
    const { logger, workdir } = makeLogger()
    logger.markPhase('prep:loading-prior-review')
    logger.markPhase('prep:preparing-source:snapshot')
    // Simulate two parallel branches; only the wrapper supplies the right phase.
    await Promise.all([
      withCurrentPhase('prep:loading-prior-review', async () => {
        logger.recordCall({
          command: ['gh', 'api', 'reviews'],
          stdout: '[]',
          stderr: '',
          exitCode: 0,
          durationMs: 10,
          ts: Date.now(),
        })
      }),
      withCurrentPhase('prep:preparing-source:snapshot', async () => {
        logger.recordCall({
          command: ['gh', 'api', 'contents'],
          stdout: '{}',
          stderr: '',
          exitCode: 0,
          durationMs: 12,
          ts: Date.now(),
        })
      }),
    ])
    const calls = readFileSync(join(workdir, 'prep.log'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .filter((e) => e.kind === 'call')
    const reviews = calls.find((c) => c.command.includes('reviews'))
    const contents = calls.find((c) => c.command.includes('contents'))
    expect(reviews.phase).toBe('prep:loading-prior-review')
    expect(contents.phase).toBe('prep:preparing-source:snapshot')
  })

  it('caps SSE stdout payload at ~64 KB but writes the full body to prep.log', () => {
    const { logger, workdir, events } = makeLogger()
    logger.markPhase('prep:fetching-pr')
    const big = 'x'.repeat(80 * 1024)
    logger.recordCall({
      command: ['gh', 'api', 'something-huge'],
      stdout: big,
      stderr: '',
      exitCode: 0,
      durationMs: 1,
      ts: Date.now(),
    })
    const written = JSON.parse(
      readFileSync(join(workdir, 'prep.log'), 'utf8').trim().split('\n')[1]!,
    )
    expect(written.stdout.length).toBe(big.length)
    const sse = events.find((e) => e.type === 'prep-output')
    if (sse?.type !== 'prep-output') throw new Error('expected prep-output')
    expect(sse.stdout.length).toBeLessThan(big.length)
    expect(sse.stdout).toContain('… [truncated')
  })
})
