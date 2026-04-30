import { describe, it, expect } from 'vitest'

import { RunnerRegistry } from '../../../src/server/engine/runner-registry'

describe('RunnerRegistry', () => {
  it('registers, reports running, cancels, and unregisters', async () => {
    const reg = new RunnerRegistry()
    expect(reg.isRunning('a')).toBe(false)

    let cancelled = 0
    reg.register('a', async () => {
      cancelled++
    })
    expect(reg.isRunning('a')).toBe(true)

    await reg.cancel('a')
    expect(cancelled).toBe(1)
    expect(reg.isRunning('a')).toBe(false)
  })

  it('cancel is a no-op when nothing is registered', async () => {
    const reg = new RunnerRegistry()
    await expect(reg.cancel('missing')).resolves.toBeUndefined()
  })

  it('unregister removes a handle without invoking it', async () => {
    const reg = new RunnerRegistry()
    let called = 0
    reg.register('b', async () => {
      called++
    })
    reg.unregister('b')
    await reg.cancel('b')
    expect(called).toBe(0)
    expect(reg.isRunning('b')).toBe(false)
  })
})
