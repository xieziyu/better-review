import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import { createApp } from '../../../src/server/api/app'
import type { RecentRepo } from '../../../src/shared/types'
import { makeTestDeps } from './_deps'

// Stand up a real git repo whose `origin` URL ends in github.com/o/r.git so
// the remote-based fallback matcher can resolve it.
function gitRepoWithRemote(owner: string, repo: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'br-recent-'))
  const run = (cmd: string): void => {
    execSync(cmd, { cwd: dir, stdio: 'ignore' })
  }
  run('git init')
  run(`git remote add origin https://github.com/${owner}/${repo}.git`)
  return dir
}

function seed(deps: ReturnType<typeof makeTestDeps>): void {
  const base = {
    title: null,
    author: null,
    url: null,
    baseRef: null,
    headRef: null,
    status: 'ready' as const,
    agent: 'claude' as const,
    workdir: '/w',
    promptUsed: 'p',
  }
  // Two repos for the foo/bar PR repo, one repo used only for an unrelated PR.
  deps.sessions.insert({
    ...base,
    id: 's1',
    owner: 'foo',
    repo: 'bar',
    number: 1,
    localRepoPath: '/Users/me/code/bar',
  })
  deps.sessions.insert({
    ...base,
    id: 's2',
    owner: 'foo',
    repo: 'bar',
    number: 2,
    localRepoPath: '/Users/me/code/bar',
  })
  deps.sessions.insert({
    ...base,
    id: 's3',
    owner: 'other',
    repo: 'thing',
    number: 1,
    localRepoPath: '/Users/me/work/thing',
  })
  deps.sessions.insert({
    ...base,
    id: 's4',
    owner: 'other',
    repo: 'thing',
    number: 2,
    // No local repo — should be excluded from the result entirely.
    localRepoPath: null,
  })
}

describe('GET /api/recent-repos', () => {
  it('returns paths derived from sessions, MRU first when no filter', async () => {
    const deps = makeTestDeps()
    seed(deps)
    const app = createApp(deps)
    const res = await app.request('/api/recent-repos')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { items: RecentRepo[] }
    expect(j.items.map((i) => i.path)).toContain('/Users/me/code/bar')
    expect(j.items.map((i) => i.path)).toContain('/Users/me/work/thing')
    // null-path session is excluded
    expect(j.items).toHaveLength(2)
    // matchedCurrentRepo is false for everyone when filter is absent
    expect(j.items.every((i) => i.matchedCurrentRepo === false)).toBe(true)
    // useCount aggregates duplicates
    const bar = j.items.find((i) => i.path === '/Users/me/code/bar')!
    expect(bar.useCount).toBe(2)
  })

  it('flags matchedCurrentRepo and orders matches first when owner+repo filter is given', async () => {
    const deps = makeTestDeps()
    seed(deps)
    const app = createApp(deps)
    const res = await app.request('/api/recent-repos?owner=foo&repo=bar')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { items: RecentRepo[] }
    expect(j.items[0]!.path).toBe('/Users/me/code/bar')
    expect(j.items[0]!.matchedCurrentRepo).toBe(true)
    const other = j.items.find((i) => i.path === '/Users/me/work/thing')!
    expect(other.matchedCurrentRepo).toBe(false)
  })

  it('honours the limit query parameter', async () => {
    const deps = makeTestDeps()
    seed(deps)
    const app = createApp(deps)
    const res = await app.request('/api/recent-repos?limit=1')
    const j = (await res.json()) as { items: RecentRepo[] }
    expect(j.items).toHaveLength(1)
  })

  it('matches a repo by git remote when no session history carries owner/repo', async () => {
    const deps = makeTestDeps()
    // A directory only ever reviewed as a local branch — no owner/repo in the
    // session row — but whose git remote points at the pasted PR's repo.
    const repoDir = gitRepoWithRemote('octo', 'widget')
    deps.sessions.insert({
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'ready',
      agent: 'claude',
      workdir: '/w',
      promptUsed: 'p',
      id: 'local1',
      owner: '',
      repo: '',
      number: 0,
      localRepoPath: repoDir,
    })
    const app = createApp(deps)
    const res = await app.request('/api/recent-repos?owner=octo&repo=widget')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { items: RecentRepo[] }
    const match = j.items.find((i) => i.path === repoDir)!
    expect(match.matchedCurrentRepo).toBe(true)
    // Matched repo is sorted first.
    expect(j.items[0]!.path).toBe(repoDir)
  })

  it('returns an empty list when no sessions have a local repo path', async () => {
    const deps = makeTestDeps()
    const app = createApp(deps)
    const res = await app.request('/api/recent-repos')
    const j = (await res.json()) as { items: RecentRepo[] }
    expect(j.items).toEqual([])
  })
})
