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

  it('serializes overlapping PUTs so the server persists the last selection', async () => {
    const resolvers: Array<(r: Response) => void> = []
    const bodies: Array<{ diffViewMode: string }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      bodies.push(JSON.parse((init as RequestInit).body as string))
      return new Promise<Response>((resolve) => resolvers.push(resolve))
    })
    const ok = (m: 'split' | 'unified') =>
      new Response(JSON.stringify({ config: { ...baseConfig, diffViewMode: m } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    const { wrapper } = setup()
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })

    // Toggle to split, then to unified while the first PUT is still in flight.
    act(() => result.current.setMode('split'))
    await waitFor(() => expect(result.current.mode).toBe('split'))
    act(() => result.current.setMode('unified'))

    // The second write is withheld (scoped serialization) until the first
    // settles — so the server never sees them out of order.
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ diffViewMode: 'split' })

    // Complete the first PUT; the queued second one now fires, after it.
    act(() => resolvers[0]!(ok('split')))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toMatchObject({ diffViewMode: 'unified' })

    // The last write on the wire is the reviewer's last selection.
    act(() => resolvers[1]!(ok('unified')))
    await waitFor(() => expect(result.current.mode).toBe('unified'))
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
