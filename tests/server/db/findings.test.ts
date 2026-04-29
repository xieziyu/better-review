import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { FindingsRepo } from '../../../src/server/db/findings'
import { SessionsRepo } from '../../../src/server/db/sessions'

describe('FindingsRepo', () => {
  let findings: FindingsRepo
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-find-'))
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
      promptUsed: 'p',
    })
    findings = new FindingsRepo(db)
  })

  it('insertMany + listBySession (active only)', () => {
    findings.insertMany('s1', [
      {
        id: 'R1',
        severity: 'must',
        category: 'Security',
        file: 'a.ts',
        line: 1,
        title: 't1',
        body: 'b1',
      },
      {
        id: 'R2',
        severity: 'nit',
        category: 'Naming',
        file: null,
        line: null,
        title: 't2',
        body: 'b2',
      },
    ])
    const list = findings.listBySession('s1', { includeArchived: false })
    expect(list).toHaveLength(2)
    expect(list[0]!.ord).toBe(1)
    expect(list[1]!.ord).toBe(2)
    expect(list[0]!.selected).toBe(true)
  })

  it('setSelected toggles flag', () => {
    findings.insertMany('s1', [
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
    const f = findings.listBySession('s1')[0]!
    findings.setSelected(f.dbId, false)
    expect(findings.getById(f.dbId)!.selected).toBe(false)
  })

  it('update sets edited=true', () => {
    findings.insertMany('s1', [
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
    const f = findings.listBySession('s1')[0]!
    findings.update(f.dbId, { title: 'new' })
    const got = findings.getById(f.dbId)!
    expect(got.title).toBe('new')
    expect(got.edited).toBe(true)
  })

  it('archiveAllForSession excludes from active list', () => {
    findings.insertMany('s1', [
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
    findings.archiveAllForSession('s1')
    expect(findings.listBySession('s1')).toHaveLength(0)
    expect(findings.listBySession('s1', { includeArchived: true })).toHaveLength(1)
  })
})
