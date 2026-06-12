import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { usePersistedState } from '@/lib/use-persisted-state'

const KEY = 'better-review:test:persisted:v1'

beforeEach(() => {
  window.localStorage.clear()
})

describe('usePersistedState', () => {
  it('uses the provided initial value when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedState(KEY, 'fallback'))
    expect(result.current[0]).toBe('fallback')
  })

  it('reads the stored value on first render, ignoring the initial', () => {
    window.localStorage.setItem(KEY, '/repo/from-storage')
    const { result } = renderHook(() => usePersistedState(KEY, 'fallback'))
    expect(result.current[0]).toBe('/repo/from-storage')
  })

  it('writes to storage and round-trips on remount', () => {
    const first = renderHook(() => usePersistedState(KEY))
    act(() => first.result.current[1]('/repo/a'))
    expect(window.localStorage.getItem(KEY)).toBe('/repo/a')

    first.unmount()
    const second = renderHook(() => usePersistedState(KEY))
    expect(second.result.current[0]).toBe('/repo/a')
  })

  it('removes the key from storage when set to an empty string', () => {
    const { result } = renderHook(() => usePersistedState(KEY))
    act(() => result.current[1]('/repo/a'))
    expect(window.localStorage.getItem(KEY)).toBe('/repo/a')

    act(() => result.current[1](''))
    expect(result.current[0]).toBe('')
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })
})
