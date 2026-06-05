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

  it('keeps the last selection when an earlier PUT resolves after a later one', async () => {
    const resolvers: Array<(r: Response) => void> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((resolve) => resolvers.push(resolve)),
    )
    const ok = (m: 'split' | 'unified') =>
      new Response(JSON.stringify({ config: { ...baseConfig, diffViewMode: m } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    const { wrapper } = setup()
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })

    // Two overlapping toggles: split, then unified. Neither PUT resolves yet.
    act(() => result.current.setMode('split'))
    await waitFor(() => expect(result.current.mode).toBe('split'))
    act(() => result.current.setMode('unified'))
    await waitFor(() => expect(result.current.mode).toBe('unified'))
    expect(resolvers).toHaveLength(2)

    // Resolve the LATER request (unified) first, then the stale earlier one.
    act(() => resolvers[1]!(ok('unified')))
    await waitFor(() => expect(result.current.mode).toBe('unified'))
    act(() => resolvers[0]!(ok('split')))

    // The stale split success must not clobber the final unified selection.
    await waitFor(() => expect(result.current.mode).toBe('unified'))
    expect(result.current.mode).toBe('unified')
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
