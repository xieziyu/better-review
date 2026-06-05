import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useDiffViewMode } from '@/lib/use-diff-view-mode'

const KEY = 'better-review:diff-view-mode:v1'

beforeEach(() => {
  window.localStorage.clear()
})

describe('useDiffViewMode', () => {
  it('defaults to unified when nothing is stored', () => {
    const { result } = renderHook(() => useDiffViewMode())
    expect(result.current.mode).toBe('unified')
  })

  it('persists and reflects a mode change', () => {
    const { result } = renderHook(() => useDiffViewMode())
    act(() => result.current.setMode('split'))
    expect(result.current.mode).toBe('split')
    expect(window.localStorage.getItem(KEY)).toBe('split')
  })

  it('reads the stored mode on init', () => {
    window.localStorage.setItem(KEY, 'split')
    const { result } = renderHook(() => useDiffViewMode())
    expect(result.current.mode).toBe('split')
  })

  it('falls back to unified for an unrecognized stored value', () => {
    window.localStorage.setItem(KEY, 'garbage')
    const { result } = renderHook(() => useDiffViewMode())
    expect(result.current.mode).toBe('unified')
  })
})
