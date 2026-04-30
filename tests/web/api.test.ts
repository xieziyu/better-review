import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, api } from '../../src/web/lib/api'

function mockFetchOnce(res: Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(res)),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api req()', () => {
  it('rerunSession resolves with fresh id on 202', async () => {
    mockFetchOnce(new Response(JSON.stringify({ id: 'fresh-1' }), { status: 202 }))
    await expect(api.rerunSession('abc')).resolves.toEqual({ id: 'fresh-1' })
  })

  it('rerunSession sends agent override in JSON body', async () => {
    const fetchMock = vi.fn<(input: RequestInfo, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'fresh-2' }), { status: 202 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    await api.rerunSession('abc', { agent: 'codex' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]!
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ agent: 'codex' }))
  })

  it('deleteSession resolves on 204 (existing behavior preserved)', async () => {
    mockFetchOnce(new Response(null, { status: 204 }))
    await expect(api.deleteSession('abc')).resolves.toBeUndefined()
  })

  it('throws ApiError with message from JSON error body', async () => {
    mockFetchOnce(
      new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(api.rerunSession('missing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'not found',
    })
  })

  it('throws ApiError with statusText fallback when error body is empty', async () => {
    mockFetchOnce(new Response(null, { status: 500, statusText: 'Internal Server Error' }))
    const err = await api.rerunSession('x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
  })
})
