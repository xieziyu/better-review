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

  it('cancelAll invokes every registered handle and empties the registry', async () => {
    const reg = new RunnerRegistry()
    const calls: string[] = []
    reg.register('a', async () => {
      calls.push('a')
    })
    reg.register('b', async () => {
      calls.push('b')
    })
    reg.register('c', async () => {
      throw new Error('c blew up')
    })

    await reg.cancelAll()

    expect(calls.sort()).toEqual(['a', 'b'])
    expect(reg.isRunning('a')).toBe(false)
    expect(reg.isRunning('b')).toBe(false)
    expect(reg.isRunning('c')).toBe(false)
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
