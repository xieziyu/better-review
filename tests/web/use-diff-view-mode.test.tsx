import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { applyDiffViewModeDefault, useDiffViewMode } from '@/lib/use-diff-view-mode'

beforeEach(() => {
  // The store is module-level (session memory). Reset to the built-in default
  // before each test so cases don't leak state into one another.
  applyDiffViewModeDefault('unified')
})

describe('useDiffViewMode', () => {
  it('starts at the built-in unified default', () => {
    const { result } = renderHook(() => useDiffViewMode())
    expect(result.current.mode).toBe('unified')
  })

  it('reflects a runtime toggle', () => {
    const { result } = renderHook(() => useDiffViewMode())
    act(() => result.current.setMode('split'))
    expect(result.current.mode).toBe('split')
  })

  it('shares the mode across hook instances (session-wide, not per-component)', () => {
    const a = renderHook(() => useDiffViewMode())
    const b = renderHook(() => useDiffViewMode())
    act(() => a.result.current.setMode('split'))
    expect(b.result.current.mode).toBe('split')
  })

  it('survives a remount (in-memory session memory)', () => {
    const first = renderHook(() => useDiffViewMode())
    act(() => first.result.current.setMode('split'))
    first.unmount()
    const second = renderHook(() => useDiffViewMode())
    expect(second.result.current.mode).toBe('split')
  })

  it('applyDiffViewModeDefault overwrites the current mode (Settings is source of truth)', () => {
    const { result } = renderHook(() => useDiffViewMode())
    act(() => result.current.setMode('split'))
    expect(result.current.mode).toBe('split')
    act(() => applyDiffViewModeDefault('unified'))
    expect(result.current.mode).toBe('unified')
  })
})
