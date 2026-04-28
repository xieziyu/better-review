import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'

describe('openDatabase', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'br-conn-'))
  })
  it('opens DB in WAL mode and runs migrations', () => {
    const db = openDatabase(join(dir, 'state.db'))
    const mode = db.pragma('journal_mode', { simple: true })
    expect(mode).toBe('wal')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toContain('pr_sessions')
    expect(tables.map((t) => t.name)).toContain('findings')
    expect(tables.map((t) => t.name)).toContain('submissions')
    db.close()
  })
})
