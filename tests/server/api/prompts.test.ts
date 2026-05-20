import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import { makeTestDeps } from './_deps'

describe('prompts API', () => {
  it('GET /api/prompts returns framework + rules state in the configured language', async () => {
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
    // Default config.language is 'en', so the English framework + rules are returned.
    expect(j.framework.content).toContain('Severity rubric')
    expect(j.rules.effective.content).toContain('Scope & Plan Alignment')
    expect(j.rules.scopes.global.exists).toBe(false)
    // No repo provided: the project scope has no file to point at.
    expect(j.repo).toBeNull()
    expect(j.rules.scopes.project.exists).toBe(false)
    expect(j.rules.scopes.project.path).toBeNull()
  })

  it('GET /api/prompts honors config.language=zh-CN', async () => {
    const d = makeTestDeps({
      config: {
        port: 5555,
        maxConcurrentReviews: 1,
        stallMinutes: 1,
        defaultAgent: 'claude',
        perPRGCDays: 1,
        language: 'zh-CN',
        reviewExcludeGlobs: [],
      },
    })
    const app = createApp(d)
    const res = await app.request('/api/prompts')
    const j = await res.json()
    expect(j.framework.content).toContain('严重程度判定')
    expect(j.rules.effective.source).toBe('builtin')
    expect(j.rules.effective.content).toContain('范围与计划对齐')
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

  it('GET /api/prompts?repo= resolves the project scope against that repo', async () => {
    const d = makeTestDeps()
    const repo = mkdtempSync(join(tmpdir(), 'br-repo-'))
    d.promptStore.write('project', 'PROJECT', repo)
    const app = createApp(d)
    const res = await app.request(`/api/prompts?repo=${encodeURIComponent(repo)}`)
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.repo).toBe(repo)
    expect(j.rules.effective.source).toBe('project')
    expect(j.rules.effective.content).toBe('PROJECT')
    expect(j.rules.scopes.project.exists).toBe(true)
    expect(j.rules.scopes.project.content).toBe('PROJECT')
    expect(j.rules.scopes.project.path).toBe(join(repo, '.better-review', 'review.md'))
  })

  it('GET /api/prompts?repo= rejects a non-existent repo path', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/prompts?repo=/no/such/dir/br-test')
    expect(res.status).toBe(400)
  })

  it('PUT /api/prompts/global writes file', async () => {
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

  it('PUT /api/prompts/project writes into the given repo', async () => {
    const d = makeTestDeps()
    const repo = mkdtempSync(join(tmpdir(), 'br-repo-'))
    const app = createApp(d)
    const res = await app.request('/api/prompts/project', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'PROJECT', repo }),
    })
    expect(res.status).toBe(200)
    expect(d.promptStore.read('project', repo)).toBe('PROJECT')
  })

  it('PUT /api/prompts/project rejects a missing repo', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/prompts/project', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'PROJECT' }),
    })
    expect(res.status).toBe(400)
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

  it('DELETE /api/prompts/global removes file', async () => {
    const d = makeTestDeps()
    d.promptStore.write('global', 'X')
    const app = createApp(d)
    const res = await app.request('/api/prompts/global', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(d.promptStore.read('global')).toBeNull()
  })

  it('DELETE /api/prompts/project removes the file in the given repo', async () => {
    const d = makeTestDeps()
    const repo = mkdtempSync(join(tmpdir(), 'br-repo-'))
    d.promptStore.write('project', 'X', repo)
    const app = createApp(d)
    const res = await app.request(`/api/prompts/project?repo=${encodeURIComponent(repo)}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(204)
    expect(d.promptStore.read('project', repo)).toBeNull()
  })

  it('DELETE /api/prompts/project rejects a missing repo', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/prompts/project', { method: 'DELETE' })
    expect(res.status).toBe(400)
  })
})
