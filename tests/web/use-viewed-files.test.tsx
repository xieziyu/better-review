import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useViewedFiles } from '@/lib/use-viewed-files'

const SESSION_ID = 'test-session-1'
const STORAGE_KEY = `better-review:files-viewed:${SESSION_ID}`

beforeEach(() => {
  window.localStorage.clear()
})

describe('useViewedFiles', () => {
  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useViewedFiles(SESSION_ID))
    expect(result.current.viewedCount).toBe(0)
    expect(result.current.isViewed('a.ts')).toBe(false)
    expect([...result.current.viewed]).toEqual([])
  })

  it('toggle adds then removes a path and tracks viewedCount', () => {
    const { result } = renderHook(() => useViewedFiles(SESSION_ID))

    act(() => result.current.toggle('src/a.ts'))
    expect(result.current.isViewed('src/a.ts')).toBe(true)
    expect(result.current.viewedCount).toBe(1)

    act(() => result.current.toggle('src/b.ts'))
    expect(result.current.viewedCount).toBe(2)

    act(() => result.current.toggle('src/a.ts'))
    expect(result.current.isViewed('src/a.ts')).toBe(false)
    expect(result.current.viewedCount).toBe(1)
  })

  it('persists viewed paths to localStorage and round-trips on remount', () => {
    const first = renderHook(() => useViewedFiles(SESSION_ID))
    act(() => first.result.current.toggle('src/a.ts'))
    act(() => first.result.current.toggle('src/b.ts'))

    const stored = window.localStorage.getItem(STORAGE_KEY)
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored!)).toEqual(['src/a.ts', 'src/b.ts'])

    first.unmount()
    const second = renderHook(() => useViewedFiles(SESSION_ID))
    expect(second.result.current.viewedCount).toBe(2)
    expect(second.result.current.isViewed('src/b.ts')).toBe(true)
  })

  it('re-reads stored state when the sessionId changes', () => {
    window.localStorage.setItem(
      'better-review:files-viewed:session-B',
      JSON.stringify(['only/in/b.ts']),
    )
    const { result, rerender } = renderHook(({ id }) => useViewedFiles(id), {
      initialProps: { id: 'session-A' },
    })
    expect(result.current.viewedCount).toBe(0)

    rerender({ id: 'session-B' })
    expect(result.current.isViewed('only/in/b.ts')).toBe(true)
    expect(result.current.viewedCount).toBe(1)
  })

  it('falls back to empty when stored JSON is corrupt or not an array', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    const corrupt = renderHook(() => useViewedFiles(SESSION_ID))
    expect(corrupt.result.current.viewedCount).toBe(0)
    corrupt.unmount()

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: 1 }))
    const notArray = renderHook(() => useViewedFiles(SESSION_ID))
    expect(notArray.result.current.viewedCount).toBe(0)
  })

  it('keeps state in-memory only when sessionId is undefined', () => {
    const { result } = renderHook(() => useViewedFiles(undefined))
    act(() => result.current.toggle('src/a.ts'))
    expect(result.current.isViewed('src/a.ts')).toBe(true)
    // Nothing written to storage under the undefined key.
    expect(window.localStorage.getItem('better-review:files-viewed:undefined')).toBeNull()
  })
})
