import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import type { SSEEvent } from '../../../src/shared/types'
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

describe('POST /api/sessions/:id/findings/manual', () => {
  it('creates a manual finding and emits finding-added SSE', async () => {
    const d = seed()
    const events: SSEEvent[] = []
    d.bus.subscribeGlobal((e) => events.push(e))
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/findings/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        severity: 'must',
        category: 'Correctness',
        file: 'src/foo.ts',
        line: 12,
        title: 'manual finding',
        body: 'this is wrong',
      }),
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { finding: { source: string; file: string; line: number } }
    expect(json.finding.source).toBe('manual')
    expect(json.finding.file).toBe('src/foo.ts')
    expect(json.finding.line).toBe(12)

    const added = events.find((e) => e.type === 'finding-added')
    expect(added).toBeDefined()
    if (added?.type === 'finding-added') {
      expect(added.sessionId).toBe('s1')
      expect(added.finding.source).toBe('manual')
    }
  })

  it('creates a file-level manual finding when line is omitted', async () => {
    const d = seed()
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/findings/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        severity: 'must',
        category: 'Scope',
        file: 'src/foo.ts',
        title: 'this file should not be committed',
        body: 'reason…',
      }),
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as {
      finding: { source: string; file: string; line: number | null }
    }
    expect(json.finding.source).toBe('manual')
    expect(json.finding.file).toBe('src/foo.ts')
    expect(json.finding.line).toBeNull()
  })

  it('rejects startLine without line', async () => {
    const d = seed()
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/findings/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        severity: 'must',
        category: 'x',
        file: 'a.ts',
        startLine: 3,
        title: 't',
        body: 'b',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing file', async () => {
    const d = seed()
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/findings/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        severity: 'must',
        category: 'x',
        line: 12,
        title: 't',
        body: 'b',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects non-positive line', async () => {
    const d = seed()
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/findings/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        severity: 'must',
        category: 'x',
        file: 'a.ts',
        line: 0,
        title: 't',
        body: 'b',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown session', async () => {
    const d = seed()
    const app = createApp(d)
    const res = await app.request('/api/sessions/nope/findings/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        severity: 'must',
        category: 'x',
        file: 'a.ts',
        line: 1,
        title: 't',
        body: 'b',
      }),
    })
    expect(res.status).toBe(404)
  })

  it('rejects invalid json', async () => {
    const d = seed()
    const app = createApp(d)
    const res = await app.request('/api/sessions/s1/findings/manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })
})
