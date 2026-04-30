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
