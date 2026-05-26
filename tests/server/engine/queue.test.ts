import { describe, it, expect } from 'vitest'

import { ConcurrencyQueue } from '../../../src/server/engine/queue'

describe('ConcurrencyQueue', () => {
  it('runs up to maxActive in parallel', async () => {
    const q = new ConcurrencyQueue(2)
    let running = 0
    let peak = 0
    const job = async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 50))
      running--
    }
    await Promise.all([q.run('a', job), q.run('b', job), q.run('c', job), q.run('d', job)])
    expect(peak).toBe(2)
  })

  it('returns same promise for same key while running', async () => {
    const q = new ConcurrencyQueue(2)
    let calls = 0
    const job = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 50))
    }
    const p1 = q.run('x', job)
    const p2 = q.run('x', job)
    await Promise.all([p1, p2])
    expect(calls).toBe(1)
  })

  it('quiesce() resolves immediately when idle', async () => {
    const q = new ConcurrencyQueue(2)
    await expect(q.quiesce()).resolves.toBeUndefined()
  })

  it('quiesce() waits for in-flight tasks to settle', async () => {
    const q = new ConcurrencyQueue(2)
    let finished = false
    const slow = q.run(
      'slow',
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            finished = true
            resolve()
          }, 30)
        }),
    )
    await q.quiesce()
    expect(finished).toBe(true)
    await slow
  })

  it('quiesce(timeout) resolves even if work never finishes', async () => {
    const q = new ConcurrencyQueue(1)
    let release: (() => void) | null = null
    const stuck = q.run('stuck', () => new Promise<void>((r) => (release = r)))
    const t0 = Date.now()
    await q.quiesce(50)
    expect(Date.now() - t0).toBeLessThan(500)
    // Unblock so the test process can exit cleanly.
    release!()
    await stuck
  })

  it('drop(key) resolves and removes pending entries without running them', async () => {
    const q = new ConcurrencyQueue(1)
    let ran = 0
    const slow = () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          ran++
          resolve()
        }, 50)
      })
    const blocker = q.run('blocker', slow)
    const dropped = q.run('drop-me', async () => {
      ran++
    })
    expect(q.pendingCount()).toBe(1)

    q.drop('drop-me')
    await dropped
    expect(q.pendingCount()).toBe(0)

    await blocker
    expect(ran).toBe(1)
  })
})
