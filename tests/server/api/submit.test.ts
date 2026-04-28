import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import { makeTestDeps } from './_deps'

describe('submit API', () => {
  it('POST /api/sessions/:id/submit returns url + dropped', async () => {
    const d = makeTestDeps({
      submitSession: async (id, event, body) => {
        expect(id).toBe('s1')
        expect(event).toBe('COMMENT')
        expect(body).toBe('hello')
        return { url: 'https://gh/r/1', droppedToBody: ['d1'] }
      },
    })
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'COMMENT', body: 'hello' }),
    })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.url).toBe('https://gh/r/1')
    expect(j.droppedToBody).toEqual(['d1'])
  })

  it('POST /api/sessions/:id/submit rejects missing event', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/sessions/:id/submit returns 502 on gh error', async () => {
    const d = makeTestDeps({
      submitSession: async () => {
        throw new Error('gh down')
      },
    })
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'APPROVE' }),
    })
    expect(res.status).toBe(502)
    const j = await res.json()
    expect(j.error).toBe('gh down')
  })
})
