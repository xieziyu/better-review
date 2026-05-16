import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import { makeTestDeps } from './_deps'

function seed() {
  const d = makeTestDeps()
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
    status: 'ready',
    agent: 'claude',
    workdir: '/w',
    localRepoPath: null,
    promptUsed: 'p',
  })
  return d
}

describe('findings API', () => {
  it('PATCH /api/findings/:id updates fields', async () => {
    const d = seed()
    d.findings.insertMany('s1', [
      { id: 'R1', severity: 'must', category: 'x', file: null, line: null, title: 't', body: 'b' },
    ])
    const f = d.findings.listBySession('s1')[0]!
    const app = createApp(d)
    const res = await app.request(`/api/findings/${f.dbId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'new' }),
    })
    expect(res.status).toBe(200)
    expect(d.findings.getById(f.dbId)!.title).toBe('new')
  })

  it('PATCH /api/findings/:id/select toggles selection', async () => {
    const d = seed()
    d.findings.insertMany('s1', [
      { id: 'R1', severity: 'must', category: 'x', file: null, line: null, title: 't', body: 'b' },
    ])
    const f = d.findings.listBySession('s1')[0]!
    const app = createApp(d)
    const res = await app.request(`/api/findings/${f.dbId}/select`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selected: false }),
    })
    expect(res.status).toBe(200)
    expect(d.findings.getById(f.dbId)!.selected).toBe(false)
  })

  it('DELETE /api/findings/:id removes finding', async () => {
    const d = seed()
    d.findings.insertMany('s1', [
      { id: 'R1', severity: 'must', category: 'x', file: null, line: null, title: 't', body: 'b' },
    ])
    const f = d.findings.listBySession('s1')[0]!
    const app = createApp(d)
    const res = await app.request(`/api/findings/${f.dbId}`, { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(d.findings.getById(f.dbId)).toBeNull()
  })

  describe('archived session is read-only', () => {
    function seedArchived() {
      const d = seed()
      d.findings.insertMany('s1', [
        {
          id: 'R1',
          severity: 'must',
          category: 'x',
          file: null,
          line: null,
          title: 't',
          body: 'b',
        },
      ])
      // Mirror rerun-session.ts: archive findings first, then flip status.
      d.findings.archiveAllForSession('s1')
      d.sessions.setStatus('s1', 'archived')
      return d
    }

    it('PATCH /api/findings/:id returns 409 when session is archived', async () => {
      const d = seedArchived()
      const f = d.findings.listBySession('s1', { includeArchived: true })[0]!
      const app = createApp(d)
      const res = await app.request(`/api/findings/${f.dbId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'new' }),
      })
      expect(res.status).toBe(409)
      // Unchanged in DB.
      expect(d.findings.getById(f.dbId)!.title).toBe('t')
    })

    it('PATCH /api/findings/:id/select returns 409 when session is archived', async () => {
      const d = seedArchived()
      const f = d.findings.listBySession('s1', { includeArchived: true })[0]!
      const app = createApp(d)
      const res = await app.request(`/api/findings/${f.dbId}/select`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selected: false }),
      })
      expect(res.status).toBe(409)
      expect(d.findings.getById(f.dbId)!.selected).toBe(true)
    })

    it('DELETE /api/findings/:id returns 409 when session is archived', async () => {
      const d = seedArchived()
      const f = d.findings.listBySession('s1', { includeArchived: true })[0]!
      const app = createApp(d)
      const res = await app.request(`/api/findings/${f.dbId}`, { method: 'DELETE' })
      expect(res.status).toBe(409)
      expect(d.findings.getById(f.dbId)).not.toBeNull()
    })

    it('POST /api/sessions/:id/findings/manual returns 409 when session is archived', async () => {
      const d = seedArchived()
      const app = createApp(d)
      const res = await app.request('/api/sessions/s1/findings/manual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          severity: 'nit',
          category: 'x',
          file: 'a.ts',
          line: 1,
          title: 't',
          body: 'b',
        }),
      })
      expect(res.status).toBe(409)
    })
  })
})
