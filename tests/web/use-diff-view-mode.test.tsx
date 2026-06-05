import type { AppConfig } from '@shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDiffViewMode } from '@/lib/use-diff-view-mode'

const baseConfig: AppConfig = {
  port: 0,
  maxConcurrentReviews: 4,
  stallMinutes: 3,
  defaultAgent: 'claude',
  perPRGCDays: 7,
  language: 'en',
  reviewExcludeGlobs: [],
  diffViewMode: 'unified',
}

function setup(opts?: { config?: AppConfig }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  qc.setQueryData(['config'], {
    config: opts?.config ?? baseConfig,
    file: '/Users/x/.better-review/config.json',
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return { qc, wrapper }
}

describe('useDiffViewMode', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reflects the persisted mode from config', () => {
    const { wrapper } = setup({ config: { ...baseConfig, diffViewMode: 'split' } })
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })
    expect(result.current.mode).toBe('split')
  })

  it('defaults to unified when config stores unified', () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })
    expect(result.current.mode).toBe('unified')
  })

  it('PUTs the full config with the new mode and optimistically updates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ config: { ...baseConfig, diffViewMode: 'split' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const { wrapper } = setup()
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })

    act(() => result.current.setMode('split'))
    // Optimistic cache write re-renders the hook to the new mode.
    await waitFor(() => expect(result.current.mode).toBe('split'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/config')
    expect((init as RequestInit).method).toBe('PUT')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toMatchObject({ ...baseConfig, diffViewMode: 'split' })
  })

  it('does not PUT when the mode is unchanged', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { wrapper } = setup()
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })
    act(() => result.current.setMode('unified'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rolls back to the previous mode when the PUT fails', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 500 }))
    const { wrapper } = setup()
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })

    act(() => result.current.setMode('split'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // A failed PUT must not leave the cached preference stuck on the optimistic value.
    await waitFor(() => expect(result.current.mode).toBe('unified'))
  })
})
