import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { SessionsRepo } from '../../../src/server/db/sessions'

describe('SessionsRepo', () => {
  let repo: SessionsRepo
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-sess-'))
    repo = new SessionsRepo(openDatabase(join(dir, 's.db')))
  })

  const sample = {
    id: 's1',
    owner: 'o',
    repo: 'r',
    number: 1,
    title: 't',
    author: 'a',
    url: 'u',
    baseRef: 'main',
    headRef: 'feat',
    status: 'running' as const,
    agent: 'claude' as const,
    workdir: '/w',
    promptUsed: 'p',
  }

  it('insert + getById round-trip', () => {
    repo.insert(sample)
    const got = repo.getById('s1')
    expect(got?.title).toBe('t')
    expect(got?.status).toBe('running')
  })

  it('list returns all sessions newest-first', async () => {
    repo.insert(sample)
    await new Promise((r) => setTimeout(r, 5))
    repo.insert({ ...sample, id: 's2', number: 2 })
    expect(repo.list().map((s) => s.id)).toEqual(['s2', 's1'])
  })

  it('findActiveByPR ignores archived', () => {
    repo.insert(sample)
    repo.setStatus('s1', 'archived')
    expect(repo.findActiveByPR('o', 'r', 1)).toBeNull()
  })

  it('setStatus + setError update timestamps', async () => {
    repo.insert(sample)
    const before = repo.getById('s1')!.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    repo.setStatus('s1', 'ready')
    repo.setError('s1', 'boom')
    const after = repo.getById('s1')!
    expect(after.status).toBe('ready')
    expect(after.error).toBe('boom')
    expect(after.updatedAt).toBeGreaterThanOrEqual(before)
  })
})
