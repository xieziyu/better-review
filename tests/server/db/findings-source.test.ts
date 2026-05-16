import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { FindingsRepo } from '../../../src/server/db/findings'
import { SessionsRepo } from '../../../src/server/db/sessions'

describe('Finding source field', () => {
  let findings: FindingsRepo
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-find-src-'))
    const db = openDatabase(join(dir, 'f.db'))
    new SessionsRepo(db).insert({
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
    findings = new FindingsRepo(db)
  })

  it('insertMany defaults source to "agent"', () => {
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'a.ts',
        line: 1,
        title: 't',
        body: 'b',
      },
    ])
    const f = findings.listBySession('s1')[0]!
    expect(f.source).toBe('agent')
  })

  it('insertManual sets source to "manual" and synthesizes agent-side id', () => {
    const created = findings.insertManual('s1', {
      severity: 'should',
      category: 'Style',
      file: 'src/foo.ts',
      line: 10,
      title: 'use const',
      body: 'prefer const over let here',
    })
    expect(created.source).toBe('manual')
    expect(created.id).toMatch(/^M/)
    expect(created.selected).toBe(true)
    expect(created.edited).toBe(false)
    expect(created.archived).toBe(false)
    const fromList = findings.listBySession('s1')[0]!
    expect(fromList.source).toBe('manual')
    expect(fromList.file).toBe('src/foo.ts')
    expect(fromList.line).toBe(10)
  })

  it('insertManual preserves optional startLine and suggestion', () => {
    const created = findings.insertManual('s1', {
      severity: 'nit',
      category: 'Naming',
      file: 'a.ts',
      line: 5,
      startLine: 3,
      title: 't',
      body: 'b',
      suggestion: 'rename to bar',
    })
    expect(created.startLine).toBe(3)
    expect(created.suggestion).toBe('rename to bar')
  })

  it('manual + agent findings coexist in same session listing', () => {
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'x',
        file: 'a.ts',
        line: 1,
        title: 'agent finding',
        body: 'b',
      },
    ])
    findings.insertManual('s1', {
      severity: 'should',
      category: 'y',
      file: 'a.ts',
      line: 2,
      title: 'manual finding',
      body: 'b',
    })
    const list = findings.listBySession('s1')
    expect(list).toHaveLength(2)
    expect(list.find((f) => f.title === 'agent finding')?.source).toBe('agent')
    expect(list.find((f) => f.title === 'manual finding')?.source).toBe('manual')
  })
})
