import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import { makeTestDeps } from './_deps'

describe('prompts API', () => {
  it('GET /api/prompts returns framework + rules state', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/prompts')
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(typeof j.framework.content).toBe('string')
    expect(j.framework.content).toContain('{{RULES}}')
    expect(j.framework.content).toContain('{{FINDINGS_PATH}}')
    expect(j.rules.effective.source).toBe('builtin')
    expect(j.rules.effective.path).toBeNull()
    expect(j.rules.effective.content).toContain('Scope & Plan Alignment')
    expect(j.rules.scopes.global.exists).toBe(false)
    expect(j.rules.scopes.project.exists).toBe(false)
  })

  it('GET /api/prompts reflects written global scope', async () => {
    const d = makeTestDeps()
    d.promptStore.write('global', 'GLOBAL')
    const app = createApp(d)
    const res = await app.request('/api/prompts')
    const j = await res.json()
    expect(j.rules.effective.source).toBe('global')
    expect(j.rules.effective.content).toBe('GLOBAL')
    expect(j.rules.scopes.global.exists).toBe(true)
    expect(j.rules.scopes.global.content).toBe('GLOBAL')
  })

  it('PUT /api/prompts/:scope writes file', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/prompts/global', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'GLOBAL' }),
    })
    expect(res.status).toBe(200)
    expect(d.promptStore.read('global')).toBe('GLOBAL')
  })

  it('PUT /api/prompts/:scope rejects invalid scope', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/prompts/bogus', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'X' }),
    })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/prompts/:scope removes file', async () => {
    const d = makeTestDeps()
    d.promptStore.write('global', 'X')
    const app = createApp(d)
    const res = await app.request('/api/prompts/global', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(d.promptStore.read('global')).toBeNull()
  })
})
