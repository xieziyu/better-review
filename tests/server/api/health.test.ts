import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import { makeTestDeps } from './_deps'

describe('GET /api/health', () => {
  it('returns health JSON', async () => {
    const app = createApp(makeTestDeps())
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; gh: { authed: boolean } }
    expect(j.ok).toBe(true)
    expect(j.gh.authed).toBe(true)
  })
})
