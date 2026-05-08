import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import type { FolderPicker } from '../../../src/server/fs/folder-picker'
import { makeTestDeps } from './_deps'

function picker(overrides: Partial<FolderPicker> = {}): FolderPicker {
  const base: FolderPicker = {
    kind: 'darwin',
    supported: true,
    pick: async () => ({ path: '/Users/me/code/foo' }),
  }
  return { ...base, ...overrides }
}

describe('POST /api/fs/pick-directory', () => {
  it('returns the picked path on success', async () => {
    const deps = makeTestDeps({ folderPicker: picker() })
    const app = createApp(deps)
    const res = await app.request('/api/fs/pick-directory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Pick repo' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { path: string | null }
    expect(j.path).toBe('/Users/me/code/foo')
  })

  it('returns { path: null } when the user cancels', async () => {
    const deps = makeTestDeps({
      folderPicker: picker({ pick: async () => ({ path: null }) }),
    })
    const app = createApp(deps)
    const res = await app.request('/api/fs/pick-directory', { method: 'POST' })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { path: string | null }
    expect(j.path).toBeNull()
  })

  it('returns 501 when the platform does not support a native picker', async () => {
    const deps = makeTestDeps({
      folderPicker: picker({
        kind: 'unsupported',
        supported: false,
        pick: async () => {
          throw new Error('boom')
        },
      }),
    })
    const app = createApp(deps)
    const res = await app.request('/api/fs/pick-directory', { method: 'POST' })
    expect(res.status).toBe(501)
  })

  it('returns 500 with the error message when the picker throws', async () => {
    const deps = makeTestDeps({
      folderPicker: picker({
        pick: async () => {
          throw new Error('osascript exploded')
        },
      }),
    })
    const app = createApp(deps)
    const res = await app.request('/api/fs/pick-directory', { method: 'POST' })
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: string }
    expect(j.error).toContain('osascript exploded')
  })

  it('forwards the prompt argument', async () => {
    let received: string | undefined
    const deps = makeTestDeps({
      folderPicker: picker({
        pick: async (opts) => {
          received = opts?.prompt
          return { path: '/x' }
        },
      }),
    })
    const app = createApp(deps)
    await app.request('/api/fs/pick-directory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Pick a clone of foo/bar' }),
    })
    expect(received).toBe('Pick a clone of foo/bar')
  })
})
