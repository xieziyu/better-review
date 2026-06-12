import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import { makeRerunSession } from '../../../src/server/rerun-session'
import type { PRSession, Finding } from '../../../src/shared/types'
import { makeTestDeps } from './_deps'

describe('sessions API', () => {
  it('POST /api/sessions creates and returns id', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prInput: 'https://github.com/owner/repo/pull/1' }),
    })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { id: string }).id).toBe('new1')
  })

  it('POST /api/sessions forwards a valid agent override', async () => {
    let received: { source: unknown; agent?: string } | null = null
    const deps = makeTestDeps({
      startSession: async (input) => {
        received = input
        return { id: 'new1' }
      },
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prInput: 'https://github.com/owner/repo/pull/1', agent: 'codex' }),
    })
    expect(res.status).toBe(201)
    expect(received).toEqual({
      source: { kind: 'github-pr', owner: 'owner', repo: 'repo', number: 1 },
      agent: 'codex',
    })
  })

  it('POST /api/sessions rejects an unknown agent', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prInput: 'https://github.com/owner/repo/pull/1', agent: 'gemini' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/sessions forwards localRepoPath to startSession', async () => {
    let received: { source: unknown; agent?: string; localRepoPath?: string } | null = null
    const deps = makeTestDeps({
      startSession: async (input) => {
        received = input
        return { id: 'new1' }
      },
    })
    const repoDir = mkdtempSync(join(tmpdir(), 'br-api-lrp-'))
    const app = createApp(deps)
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prInput: 'https://github.com/owner/repo/pull/1',
        localRepoPath: repoDir,
      }),
    })
    expect(res.status).toBe(201)
    expect(received).toEqual({
      source: { kind: 'github-pr', owner: 'owner', repo: 'repo', number: 1 },
      localRepoPath: repoDir,
    })
  })

  it('POST /api/sessions drops empty/whitespace localRepoPath silently', async () => {
    let received: { source: unknown; agent?: string; localRepoPath?: string } | null = null
    const deps = makeTestDeps({
      startSession: async (input) => {
        received = input
        return { id: 'new1' }
      },
    })
    const app = createApp(deps)
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prInput: 'https://github.com/owner/repo/pull/1',
        localRepoPath: '   ',
      }),
    })
    expect(received).toEqual({
      source: { kind: 'github-pr', owner: 'owner', repo: 'repo', number: 1 },
    })
  })

  it('POST /api/sessions forwards extraPrompt to startSession', async () => {
    let received: {
      source: unknown
      agent?: string
      localRepoPath?: string
      extraPrompt?: string
    } | null = null
    const deps = makeTestDeps({
      startSession: async (input) => {
        received = input
        return { id: 'new1' }
      },
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prInput: 'https://github.com/owner/repo/pull/1',
        extraPrompt: 'see PRD section 4',
      }),
    })
    expect(res.status).toBe(201)
    expect(received).toEqual({
      source: { kind: 'github-pr', owner: 'owner', repo: 'repo', number: 1 },
      extraPrompt: 'see PRD section 4',
    })
  })

  it('POST /api/sessions drops empty/whitespace extraPrompt silently', async () => {
    let received: { source: unknown; extraPrompt?: string } | null = null
    const deps = makeTestDeps({
      startSession: async (input) => {
        received = input
        return { id: 'new1' }
      },
    })
    const app = createApp(deps)
    await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prInput: 'https://github.com/owner/repo/pull/1',
        extraPrompt: '   \n\n',
      }),
    })
    expect(received).toEqual({
      source: { kind: 'github-pr', owner: 'owner', repo: 'repo', number: 1 },
    })
  })

  it('POST /api/sessions rejects non-string extraPrompt', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prInput: 'https://github.com/owner/repo/pull/1',
        extraPrompt: 99,
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/sessions with a path + vbranchName builds a gitbutler-vbranch source', async () => {
    let received: { source: unknown } | null = null
    const deps = makeTestDeps({
      startSession: async (input) => {
        received = input
        return { id: 'vb1' }
      },
    })
    const repoDir = mkdtempSync(join(tmpdir(), 'br-api-vb-'))
    const app = createApp(deps)
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prInput: repoDir, vbranchName: 'feature-x' }),
    })
    expect(res.status).toBe(201)
    expect(received).toEqual({
      source: {
        kind: 'gitbutler-vbranch',
        repoPath: repoDir,
        vbranchName: 'feature-x',
        base: 'auto',
      },
    })
  })

  it('POST /api/sessions rejects non-string vbranchName', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prInput: '/tmp/x', vbranchName: 99 }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/sessions rejects non-string localRepoPath', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prInput: 'https://github.com/owner/repo/pull/1',
        localRepoPath: 42,
      }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/sessions surfaces startSession validation errors as 400', async () => {
    const deps = makeTestDeps({
      startSession: async () => {
        throw new Error('localRepoPath does not exist: /no/such/dir')
      },
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prInput: 'https://github.com/owner/repo/pull/1',
        localRepoPath: '/no/such/dir',
      }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/does not exist/)
  })

  it('GET /api/sessions lists', async () => {
    const deps = makeTestDeps()
    deps.sessions.insert({
      id: 's1',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'running',
      agent: 'claude',
      workdir: '/w',
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions')
    expect(res.status).toBe(200)
    const list = (await res.json()) as PRSession[]
    expect(list).toHaveLength(1)
  })

  it('GET /api/sessions/:id returns session + findings', async () => {
    const deps = makeTestDeps()
    deps.sessions.insert({
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
    deps.findings.insertMany('s1', [
      { id: 'R1', severity: 'must', category: 'x', file: null, line: null, title: 't', body: 'b' },
    ])
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { session: PRSession; findings: Finding[] }
    expect(j.session.id).toBe('s1')
    expect(j.findings).toHaveLength(1)
  })

  it('GET /api/sessions/:id returns historical findings when session is archived', async () => {
    // Simulates the state created by a rerun: every finding row carries
    // archived=1, the session row carries status='archived'. The endpoint
    // must surface the historical findings so the archived round stays
    // visible (read-only) in the UI.
    const deps = makeTestDeps()
    deps.sessions.insert({
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
    deps.findings.insertMany('s1', [
      { id: 'R1', severity: 'must', category: 'x', file: null, line: null, title: 't1', body: 'b' },
      { id: 'R2', severity: 'nit', category: 'y', file: null, line: null, title: 't2', body: 'b' },
    ])
    deps.findings.archiveAllForSession('s1')
    deps.sessions.setStatus('s1', 'archived')

    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { session: PRSession; findings: Finding[] }
    expect(j.session.status).toBe('archived')
    expect(j.findings).toHaveLength(2)
    expect(j.findings.every((f) => f.archived === true)).toBe(true)
  })

  it('DELETE /api/sessions/:id removes from DB', async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), 'br-del-sd-'))
    const workdir = join(sessionsDir, 'pr-o-r-1-aaaaaaaa')
    mkdirSync(workdir, { recursive: true })
    writeFileSync(join(workdir, 'sentinel'), 'x')
    const deps = makeTestDeps({ sessionsDir })
    deps.sessions.insert({
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
      workdir,
      localRepoPath: null,
      promptUsed: 'p',
    })
    deps.findings.insertMany('s1', [
      { id: 'F1', severity: 'must', category: 'x', file: null, line: null, title: 't', body: 'b' },
    ])
    deps.submissions.insert({
      sessionId: 's1',
      event: 'COMMENT',
      githubUrl: 'https://gh',
      githubReviewId: null,
      payloadJson: '{}',
      findingIds: ['F1'],
      error: null,
    })

    const app = createApp(deps)
    expect((await app.request('/api/sessions/s1', { method: 'DELETE' })).status).toBe(204)
    expect(deps.sessions.getById('s1')).toBeNull()
    expect(deps.submissions.listBySession('s1')).toHaveLength(0)
    expect(deps.findings.listBySession('s1')).toHaveLength(0)
    expect(existsSync(workdir)).toBe(false)
  })

  it('DELETE /api/sessions/:id returns 404 for unknown id', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions/missing', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/sessions/:id leaves files outside sessionsDir untouched', async () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), 'br-del-sd-'))
    const stranger = mkdtempSync(join(tmpdir(), 'br-stranger-'))
    writeFileSync(join(stranger, 'keep-me'), 'x')
    const deps = makeTestDeps({ sessionsDir })
    deps.sessions.insert({
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
      workdir: stranger,
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    expect((await app.request('/api/sessions/s1', { method: 'DELETE' })).status).toBe(204)
    expect(deps.sessions.getById('s1')).toBeNull()
    expect(existsSync(join(stranger, 'keep-me'))).toBe(true)
  })

  it('GET /api/sessions/:id/diff returns cached diff', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-diff-'))
    const diff = 'diff --git a/x b/x\n@@ -0,0 +1 @@\n+hi\n'
    writeFileSync(join(wd, 'diff.cache'), diff)
    deps.sessions.insert({
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
      workdir: wd,
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/diff')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { diff: string | null }
    expect(j.diff).toBe(diff)
  })

  it('GET /api/sessions/:id/diff returns null when diff.cache missing', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-diff-empty-'))
    deps.sessions.insert({
      id: 's1',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'running',
      agent: 'claude',
      workdir: wd,
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/diff')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { diff: string | null }
    expect(j.diff).toBeNull()
  })

  it('GET /api/sessions/:id/diff returns 404 when session unknown', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions/missing/diff')
    expect(res.status).toBe(404)
  })

  it('GET /api/sessions/:id/file reads from a worktree source', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-file-wt-'))
    mkdirSync(join(wd, 'repo', 'src'), { recursive: true })
    writeFileSync(join(wd, 'repo', 'src', 'a.ts'), 'export const a = 1\n')
    deps.sessions.insert({
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
      workdir: wd,
      localRepoPath: null,
      sourceKind: 'worktree',
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/file?path=src/a.ts')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { content: string }
    expect(j.content).toBe('export const a = 1\n')
  })

  it('GET /api/sessions/:id/file reads from a snapshot source', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-file-snap-'))
    mkdirSync(join(wd, 'source', 'src'), { recursive: true })
    writeFileSync(join(wd, 'source', 'src', 'b.ts'), 'export const b = 2\n')
    deps.sessions.insert({
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
      workdir: wd,
      localRepoPath: null,
      sourceKind: 'snapshot',
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/file?path=src/b.ts')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { content: string }
    expect(j.content).toBe('export const b = 2\n')
  })

  it('GET /api/sessions/:id/file refuses to read through a symlink escaping the source', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-file-symlink-'))
    const repo = join(wd, 'repo', 'src')
    mkdirSync(repo, { recursive: true })
    // A secret living outside the session workdir, plus an in-tree symlink to it.
    const outside = mkdtempSync(join(tmpdir(), 'br-secret-'))
    const secret = join(outside, 'id_rsa')
    writeFileSync(secret, 'PRIVATE KEY')
    symlinkSync(secret, join(repo, 'leak.ts'))
    deps.sessions.insert({
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
      workdir: wd,
      localRepoPath: null,
      sourceKind: 'worktree',
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/file?path=src/leak.ts')
    expect(res.status).toBe(400)
  })

  it('GET /api/sessions/:id/file rejects path traversal with 400', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-file-trav-'))
    mkdirSync(join(wd, 'repo'), { recursive: true })
    deps.sessions.insert({
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
      workdir: wd,
      localRepoPath: null,
      sourceKind: 'worktree',
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request(
      '/api/sessions/s1/file?path=' + encodeURIComponent('../../etc/passwd'),
    )
    expect(res.status).toBe(400)
  })

  it('GET /api/sessions/:id/file falls back to gh contents for a none source and caches', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-file-none-'))
    let calls = 0
    deps.gh = {
      getFileAtRef: async (args: { path: string; ref: string }) => {
        calls += 1
        expect(args.ref).toBe('deadbeef')
        return `// fetched ${args.path}\n`
      },
    } as unknown as typeof deps.gh
    deps.sessions.insert({
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
      workdir: wd,
      localRepoPath: null,
      sourceKind: 'none',
      headSha: 'deadbeef',
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/file?path=src/c.ts')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { content: string }).content).toBe('// fetched src/c.ts\n')
    // Second request hits the on-disk cache, not the network.
    const res2 = await app.request('/api/sessions/s1/file?path=src/c.ts')
    expect(((await res2.json()) as { content: string }).content).toBe('// fetched src/c.ts\n')
    expect(calls).toBe(1)
  })

  it('GET /api/sessions/:id/file returns 404 when the file is unavailable', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-file-404-'))
    deps.sessions.insert({
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
      workdir: wd,
      localRepoPath: null,
      sourceKind: 'none',
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/file?path=src/missing.ts')
    expect(res.status).toBe(404)
  })

  it('GET /api/sessions/:id/file returns 404 when session unknown', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions/missing/file?path=x')
    expect(res.status).toBe(404)
  })

  it('GET /api/sessions/:id/file returns 400 when path missing', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-file-nopath-'))
    deps.sessions.insert({
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
      workdir: wd,
      localRepoPath: null,
      sourceKind: 'worktree',
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/file')
    expect(res.status).toBe(400)
  })

  it('GET /api/sessions/:id/transcript replays agent.log into chunks', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-transcript-'))
    writeFileSync(
      join(wd, 'agent.log'),
      [
        '{"type":"system","subtype":"init","model":"claude-opus-4-7"}',
        '[stream-json error] noise',
        '{"type":"result","subtype":"success"}',
      ].join('\n'),
    )
    deps.sessions.insert({
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
      workdir: wd,
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/transcript')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { chunks: string[]; truncated: boolean }
    expect(j.chunks).toEqual(['system: init (model=claude-opus-4-7)', 'result: success'])
    expect(j.truncated).toBe(false)
  })

  it('GET /api/sessions/:id/transcript tail-truncates a large log', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-transcript-big-'))
    const lines = Array.from({ length: 2001 }, (_, i) => `codex line ${i}`)
    writeFileSync(join(wd, 'agent.log'), lines.join('\n'))
    deps.sessions.insert({
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
      agent: 'codex',
      workdir: wd,
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/transcript')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { chunks: string[]; truncated: boolean }
    expect(j.truncated).toBe(true)
    expect(j.chunks).toHaveLength(2000)
    expect(j.chunks[0]).toBe('codex line 1')
    expect(j.chunks[1999]).toBe('codex line 2000')
  })

  it('GET /api/sessions/:id/transcript returns empty when agent.log missing', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-transcript-empty-'))
    deps.sessions.insert({
      id: 's1',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'failed',
      agent: 'claude',
      workdir: wd,
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/transcript')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { chunks: string[]; truncated: boolean }
    expect(j.chunks).toEqual([])
    expect(j.truncated).toBe(false)
  })

  it('GET /api/sessions/:id/transcript returns 404 when session unknown', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions/missing/transcript')
    expect(res.status).toBe(404)
  })

  it('GET /api/sessions/:id/prep-log parses phase + call entries from prep.log', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-prep-'))
    writeFileSync(
      join(wd, 'prep.log'),
      [
        JSON.stringify({ kind: 'phase', phase: 'prep:fetching-pr', ts: 1 }),
        JSON.stringify({
          kind: 'call',
          phase: 'prep:fetching-pr',
          command: ['gh', 'pr', 'view', '12'],
          stdout: '{"number":12}',
          stderr: '',
          exitCode: 0,
          durationMs: 42,
          ts: 2,
        }),
        '',
        'not-json',
        JSON.stringify({ kind: 'phase', phase: 'prep:fetching-diff', ts: 3 }),
      ].join('\n'),
    )
    deps.sessions.insert({
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
      workdir: wd,
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/prep-log')
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      phases: Array<{ phase: string }>
      calls: Array<{ phase: string; command: string[] }>
      truncated: boolean
    }
    expect(j.phases.map((p) => p.phase)).toEqual(['prep:fetching-pr', 'prep:fetching-diff'])
    expect(j.calls).toHaveLength(1)
    expect(j.calls[0]?.command).toEqual(['gh', 'pr', 'view', '12'])
    expect(j.truncated).toBe(false)
  })

  it('GET /api/sessions/:id/prep-log returns empty payload when prep.log missing', async () => {
    const deps = makeTestDeps()
    const wd = mkdtempSync(join(tmpdir(), 'br-prep-empty-'))
    deps.sessions.insert({
      id: 's1',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'pending',
      agent: 'claude',
      workdir: wd,
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/prep-log')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { phases: unknown[]; calls: unknown[]; truncated: boolean }
    expect(j.phases).toEqual([])
    expect(j.calls).toEqual([])
    expect(j.truncated).toBe(false)
  })

  it('GET /api/sessions/:id/prep-log returns 404 when session unknown', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions/missing/prep-log')
    expect(res.status).toBe(404)
  })

  function insertReadySession(deps: ReturnType<typeof makeTestDeps>, id = 's1'): void {
    deps.sessions.insert({
      id,
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
  }

  it('POST /api/sessions/:id/rerun calls rerunSession and returns fresh id', async () => {
    let receivedId: string | null = null
    let receivedOpts: { agent?: string; extraPrompt?: string } | undefined
    const deps = makeTestDeps({
      rerunSession: async (id, opts) => {
        receivedId = id
        receivedOpts = opts
        return { id: 'fresh-1' }
      },
    })
    insertReadySession(deps)
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/rerun', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { id: string }
    expect(body.id).toBe('fresh-1')
    expect(receivedId).toBe('s1')
    expect(receivedOpts).toEqual({})
  })

  it('POST /api/sessions/:id/rerun forwards a valid agent override', async () => {
    let receivedOpts: { agent?: string; extraPrompt?: string } | undefined
    const deps = makeTestDeps({
      rerunSession: async (_id, opts) => {
        receivedOpts = opts
        return { id: 'fresh-2' }
      },
    })
    insertReadySession(deps)
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/rerun', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'codex' }),
    })
    expect(res.status).toBe(202)
    expect(receivedOpts?.agent).toBe('codex')
  })

  it('POST /api/sessions/:id/rerun forwards an extraPrompt override', async () => {
    let receivedOpts: { agent?: string; extraPrompt?: string } | undefined
    const deps = makeTestDeps({
      rerunSession: async (_id, opts) => {
        receivedOpts = opts
        return { id: 'fresh-3' }
      },
    })
    insertReadySession(deps)
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/rerun', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extraPrompt: 'new context' }),
    })
    expect(res.status).toBe(202)
    expect(receivedOpts?.extraPrompt).toBe('new context')
  })

  it('POST /api/sessions/:id/rerun rejects an unknown agent', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/rerun', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'gemini' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/sessions/:id/rerun returns 409 when a live head already exists for the PR', async () => {
    // Wire the real rerun factory so its archived guard fires; the route
    // translates 'already archived' to 409 (mirrors the cancel 'not running' path).
    const baseDeps = makeTestDeps()
    const realRerun = makeRerunSession({
      sessions: baseDeps.sessions,
      findings: baseDeps.findings,
      startSession: async () => ({ id: 'unused' }),
    })
    const deps = { ...baseDeps, rerunSession: realRerun }
    deps.sessions.insert({
      id: 's1',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'archived',
      agent: 'claude',
      workdir: '/w',
      localRepoPath: null,
      promptUsed: 'p',
    })
    // s2 is the current live head for the same PR.
    deps.sessions.insert({
      id: 's2',
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
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/rerun', { method: 'POST' })
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('already archived')
  })

  it('POST /api/sessions/:id/rerun recovers an orphan archived session (no live head)', async () => {
    const baseDeps = makeTestDeps()
    const realRerun = makeRerunSession({
      sessions: baseDeps.sessions,
      findings: baseDeps.findings,
      startSession: async () => ({ id: 'recovered' }),
    })
    const deps = { ...baseDeps, rerunSession: realRerun }
    deps.sessions.insert({
      id: 'orphan',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'archived',
      agent: 'claude',
      workdir: '/w',
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/orphan/rerun', { method: 'POST' })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { freshId: string }
    expect(body.freshId).toBe('recovered')
  })

  it('POST /api/sessions/:id/cancel cancels a running session and writes cancelled status', async () => {
    const deps = makeTestDeps()
    deps.sessions.insert({
      id: 's1',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'running',
      agent: 'claude',
      workdir: '/w',
      localRepoPath: null,
      promptUsed: 'p',
    })
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/cancel', { method: 'POST' })
    expect(res.status).toBe(204)
    expect(deps.sessions.getById('s1')!.status).toBe('cancelled')
  })

  it('POST /api/sessions/:id/cancel returns 409 when session is not running', async () => {
    const deps = makeTestDeps()
    deps.sessions.insert({
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
    const app = createApp(deps)
    const res = await app.request('/api/sessions/s1/cancel', { method: 'POST' })
    expect(res.status).toBe(409)
    expect(deps.sessions.getById('s1')!.status).toBe('ready')
  })

  it('POST /api/sessions/:id/cancel returns 404 for unknown id', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/sessions/missing/cancel', { method: 'POST' })
    expect(res.status).toBe(404)
  })
})
