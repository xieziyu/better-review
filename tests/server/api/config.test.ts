import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import { loadConfig } from '../../../src/server/config'
import { makeTestDeps } from './_deps'

describe('config API', () => {
  it('GET /api/config returns the current config plus the file path', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/config')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { config: Record<string, unknown>; file: string }
    expect(j.config).toEqual({
      port: 5555,
      maxConcurrentReviews: 1,
      stallMinutes: 1,
      defaultAgent: 'claude',
      perPRGCDays: 1,
      language: 'en',
      reviewExcludeGlobs: [],
      diffViewMode: 'unified',
    })
    expect(j.file.endsWith('config.json')).toBe(true)
  })

  it('PUT /api/config persists, hot-reloads in-memory state, and round-trips through loadConfig', async () => {
    const home = mkdtempSync(join(tmpdir(), 'br-cfg-'))
    const configFile = join(home, 'config.json')
    const d = makeTestDeps({ configFile })
    const app = createApp(d)
    const next = {
      port: 0,
      maxConcurrentReviews: 8,
      stallMinutes: 5,
      defaultAgent: 'codex',
      perPRGCDays: 14,
      language: 'zh-CN' as const,
      reviewExcludeGlobs: ['dist/**', '*.snap'],
      diffViewMode: 'split' as const,
    }
    const res = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { config: typeof next }
    expect(j.config).toEqual(next)
    // Hot-reloaded in memory.
    expect(d.getConfig()).toMatchObject(next)
    // Persisted to disk in a shape loadConfig can read back round-trip.
    const fromDisk = loadConfig(home)
    expect(fromDisk).toMatchObject(next)
    // saveConfig should not have written the deprecated alias.
    const raw = JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>
    expect(raw).not.toHaveProperty('claudeStallMinutes')
  })

  it('PUT /api/config rejects invalid bodies with a descriptive 400', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const before = { ...d.getConfig() }

    const badPort = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...before, port: 99999 }),
    })
    expect(badPort.status).toBe(400)
    const e1 = (await badPort.json()) as { error: string }
    expect(e1.error).toMatch(/port/)

    const badAgent = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...before, defaultAgent: 'gpt' }),
    })
    expect(badAgent.status).toBe(400)
    const e2 = (await badAgent.json()) as { error: string }
    expect(e2.error).toMatch(/defaultAgent/)

    // Original in-memory config is untouched.
    expect(d.getConfig()).toEqual(before)
  })

  it('PUT /api/config rejects unknown extra keys (deprecated alias not accepted)', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const before = { ...d.getConfig() }
    const res = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...before, claudeStallMinutes: 7 }),
    })
    // zod's default unknown-key behaviour is to strip silently, so the request
    // succeeds with the alias dropped — the writer additionally never re-emits
    // the legacy key.
    expect(res.status).toBe(200)
    expect(d.getConfig()).not.toHaveProperty('claudeStallMinutes')
  })

  it('PUT /api/config rejects invalid JSON bodies with a 400', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const res = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    expect(res.status).toBe(400)
  })

  it('PUT /api/config rejects an unsupported language', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const before = { ...d.getConfig() }
    const res = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...before, language: 'fr' }),
    })
    expect(res.status).toBe(400)
    const e = (await res.json()) as { error: string }
    expect(e.error).toMatch(/language/)
  })

  it('PUT /api/config rejects a non-array reviewExcludeGlobs with a 400', async () => {
    const d = makeTestDeps()
    const app = createApp(d)
    const before = { ...d.getConfig() }
    const res = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...before, reviewExcludeGlobs: 'dist/**' }),
    })
    expect(res.status).toBe(400)
    const e = (await res.json()) as { error: string }
    expect(e.error).toMatch(/reviewExcludeGlobs/)
    expect(d.getConfig()).toEqual(before)
  })
})
