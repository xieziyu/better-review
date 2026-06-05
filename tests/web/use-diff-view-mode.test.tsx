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

  it('persists the first toggle even before the config query has loaded', async () => {
    const patchBodies: unknown[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (method === 'PATCH') {
        patchBodies.push(JSON.parse((init as RequestInit).body as string))
        return Promise.resolve(
          new Response(JSON.stringify({ config: { ...baseConfig, diffViewMode: 'split' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      // GET /api/config — never resolves, simulating "config not loaded yet".
      return new Promise<Response>(() => {})
    })
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    // No seeded cache: the user clicks while the config query is still in flight.
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })

    expect(result.current.mode).toBe('unified')
    act(() => result.current.setMode('split'))

    // The PATCH fired (no "config not loaded" throw) carrying only its field,
    // and its success populates the cache so the choice takes effect.
    await waitFor(() => expect(patchBodies).toEqual([{ diffViewMode: 'split' }]))
    await waitFor(() => expect(result.current.mode).toBe('split'))
  })

  it('is not clobbered by a stale config GET that resolves after the PATCH', async () => {
    // Cold start: the initial GET is still reading the OLD value ('unified') off
    // disk when the user toggles to 'split'. The PATCH persists 'split' and its
    // success seeds the cache. The stale GET must NOT then resolve last and snap
    // the UI back to 'unified' — onMutate cancels the in-flight GET so its result
    // is discarded.
    let resolveGet!: (r: Response) => void
    const patchBodies: unknown[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (method === 'PATCH') {
        patchBodies.push(JSON.parse((init as RequestInit).body as string))
        return Promise.resolve(
          new Response(JSON.stringify({ config: { ...baseConfig, diffViewMode: 'split' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      // GET /api/config — held open, resolves later with the pre-PATCH value.
      return new Promise<Response>((resolve) => (resolveGet = resolve))
    })
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })

    expect(result.current.mode).toBe('unified')
    act(() => result.current.setMode('split'))

    await waitFor(() => expect(patchBodies).toEqual([{ diffViewMode: 'split' }]))
    await waitFor(() => expect(result.current.mode).toBe('split'))

    // The stale GET now resolves with the OLD on-disk value.
    act(() =>
      resolveGet(
        new Response(JSON.stringify({ config: baseConfig, file: '/x' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    // It must be ignored: the cancelled GET can't overwrite the persisted choice.
    await waitFor(() => expect(qc.isFetching()).toBe(0))
    expect(result.current.mode).toBe('split')
    expect(qc.getQueryData<{ config: AppConfig }>(['config'])?.config.diffViewMode).toBe('split')
  })

  it('persists a click matching the local default while config is unresolved', async () => {
    // Disk holds 'split', but the GET hasn't resolved so the hook shows the
    // local default 'unified'. Clicking 'unified' must still PATCH — otherwise
    // the choice is dropped and the UI snaps back to 'split' once GET returns.
    const patchBodies: unknown[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (method === 'PATCH') {
        patchBodies.push(JSON.parse((init as RequestInit).body as string))
        return Promise.resolve(
          new Response(JSON.stringify({ config: { ...baseConfig, diffViewMode: 'unified' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      return new Promise<Response>(() => {})
    })
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })

    expect(result.current.mode).toBe('unified')
    act(() => result.current.setMode('unified'))

    await waitFor(() => expect(patchBodies).toEqual([{ diffViewMode: 'unified' }]))
  })

  it('defaults to unified when config stores unified', () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })
    expect(result.current.mode).toBe('unified')
  })

  it('PATCHes only diffViewMode and optimistically updates', async () => {
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
    expect((init as RequestInit).method).toBe('PATCH')
    // Only the field this control owns — not a full snapshot that could clobber
    // another control's concurrent write.
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ diffViewMode: 'split' })
  })

  it('does not PATCH when the mode is unchanged', () => {
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

  it('does not clobber another field when a stale PATCH response arrives', async () => {
    let resolveDiff!: (r: Response) => void
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((resolve) => (resolveDiff = resolve)),
    )
    const { qc, wrapper } = setup() // seeded { language: 'en', diffViewMode: 'unified' }
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })

    // Diff PATCH goes out while the cache still says language 'en'.
    act(() => result.current.setMode('split'))
    await waitFor(() => expect(result.current.mode).toBe('split'))

    // A concurrent writer (e.g. the language switcher) updates language first.
    act(() =>
      qc.setQueryData<{ config: AppConfig; file: string }>(['config'], (prev) =>
        prev ? { ...prev, config: { ...prev.config, language: 'zh-CN' } } : prev,
      ),
    )

    // The earlier diff PATCH now resolves with a snapshot taken before that
    // language change — full-config writeback would revert language to 'en'.
    act(() =>
      resolveDiff(
        new Response(
          JSON.stringify({ config: { ...baseConfig, language: 'en', diffViewMode: 'split' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    )

    await waitFor(() => {
      const cfg = qc.getQueryData<{ config: AppConfig }>(['config'])
      expect(cfg?.config.diffViewMode).toBe('split')
      expect(cfg?.config.language).toBe('zh-CN')
    })
  })

  it('rolls back to the server value when two queued PUTs both fail', async () => {
    // split then unified, both fail. The rollback must restore the last
    // *server-confirmed* value (unified), not the un-persisted optimistic split
    // left in the first toggle's snapshot — otherwise the UI drifts away from disk.
    const resolvers: Array<(r: Response) => void> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise<Response>((resolve) => resolvers.push(resolve)),
    )
    const fail = () => new Response('nope', { status: 500 })

    const { qc, wrapper } = setup() // server holds diffViewMode 'unified'
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })

    act(() => result.current.setMode('split'))
    await waitFor(() => expect(result.current.mode).toBe('split'))
    act(() => result.current.setMode('unified'))

    // First PUT (split) fails; its scope-queued successor (unified) then fires.
    act(() => resolvers[0]!(fail()))
    await waitFor(() => expect(resolvers).toHaveLength(2))
    act(() => resolvers[1]!(fail()))

    // Gate on the mutation actually settling — the second toggle's optimistic
    // value is already 'unified', so asserting before onError runs would pass on
    // the transient even though a buggy rollback restores the un-persisted 'split'.
    await waitFor(() => expect(qc.isMutating()).toBe(0))
    // Neither write persisted, so the preference must settle back on 'unified'.
    expect(result.current.mode).toBe('unified')
  })

  it('rolls back to a server value refreshed after the last toggle, not a stale baseline', async () => {
    // The rollback baseline must keep following the config query once a toggle
    // settles. Otherwise a later refetch (window refocus, cross-tab save) updates
    // the displayed value while the baseline stays pinned to the prior toggle, and
    // the next failed toggle reverts the UI to that stale value instead of disk.
    let failNext = false
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { diffViewMode: string }
      if (failNext) return Promise.resolve(new Response('nope', { status: 500 }))
      return Promise.resolve(
        new Response(
          JSON.stringify({ config: { ...baseConfig, diffViewMode: body.diffViewMode } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
    })

    const { qc, wrapper } = setup() // server holds 'unified'
    const { result } = renderHook(() => useDiffViewMode(), { wrapper })

    // First toggle succeeds; the baseline advances to 'split'.
    act(() => result.current.setMode('split'))
    await waitFor(() => expect(result.current.mode).toBe('split'))
    await waitFor(() => expect(qc.isMutating()).toBe(0))

    // A later config refetch brings a different server-confirmed value.
    act(() =>
      qc.setQueryData<{ config: AppConfig; file: string }>(['config'], (prev) =>
        prev ? { ...prev, config: { ...prev.config, diffViewMode: 'unified' } } : prev,
      ),
    )
    await waitFor(() => expect(result.current.mode).toBe('unified'))

    // The next toggle fails — rollback must restore the refreshed 'unified', not
    // the stale 'split' baseline left by the first toggle.
    failNext = true
    act(() => result.current.setMode('split'))
    await waitFor(() => expect(qc.isMutating()).toBe(0))
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
