import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import type { SessionStatus } from '../../../src/shared/types'
import { makeTestDeps } from './_deps'

function insertSession(d: ReturnType<typeof makeTestDeps>, status: SessionStatus = 'ready'): void {
  d.sessions.insert({
    id: 's1',
    owner: 'o',
    repo: 'r',
    number: 1,
    title: null,
    author: null,
    url: null,
    baseRef: null,
    headRef: null,
    status,
    agent: 'claude',
    workdir: '/w',
    localRepoPath: null,
    promptUsed: 'p',
  })
}

describe('submit API', () => {
  it('POST /api/sessions/:id/submit returns url + dropped', async () => {
    const d = makeTestDeps({
      submitSession: async (id, event, body) => {
        expect(id).toBe('s1')
        expect(event).toBe('COMMENT')
        expect(body).toBe('hello')
        return { url: 'https://gh/r/1', droppedToBody: ['d1'], skippedDuplicates: 2 }
      },
    })
    insertSession(d)
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
    expect(j.skippedDuplicates).toBe(2)
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
    insertSession(d)
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

  it('POST /api/sessions/:id/submit returns 404 when session is unknown', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'COMMENT' }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/sessions/:id/submit returns 409 when session is archived', async () => {
    let called = false
    const d = makeTestDeps({
      submitSession: async () => {
        called = true
        return { url: '', droppedToBody: [], skippedDuplicates: 0 }
      },
    })
    insertSession(d, 'archived')
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'COMMENT' }),
    })
    expect(res.status).toBe(409)
    expect(called).toBe(false)
  })
})
