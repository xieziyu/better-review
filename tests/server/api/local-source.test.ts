import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { execa } from 'execa'
import { describe, expect, it } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import type { LocalSourceInspect } from '../../../src/shared/types'
import { makeTestDeps } from './_deps'

describe('local-source API', () => {
  it('GET /api/local-source/inspect rejects a missing path', async () => {
    const app = createApp(makeTestDeps())
    const res = await app.request('/api/local-source/inspect')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/path/)
  })

  it('GET /api/local-source/inspect returns kind=none for a non-git dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-inspect-none-'))
    const app = createApp(makeTestDeps())
    const res = await app.request(`/api/local-source/inspect?path=${encodeURIComponent(dir)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as LocalSourceInspect
    expect(body.kind).toBe('none')
    expect(body.repoPath).toBe(dir)
    expect(body.vbranches).toBeUndefined()
  })

  it('GET /api/local-source/inspect returns kind=git for a plain git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-inspect-git-'))
    await execa('git', ['-C', dir, 'init', '-b', 'main'])
    const app = createApp(makeTestDeps())
    const res = await app.request(`/api/local-source/inspect?path=${encodeURIComponent(dir)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as LocalSourceInspect
    // We don't assert against 'gitbutler' here — if the dev machine has
    // `but` installed, the inspect still returns 'git' because `but
    // setup` was never run for this fresh temp repo.
    expect(body.kind).toBe('git')
    expect(body.vbranches).toBeUndefined()
  })
})
