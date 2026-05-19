import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { resolvePaths } from '../../src/server/paths'

describe('resolvePaths', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'br-'))
  })
  it('returns absolute paths under home dir', () => {
    const p = resolvePaths(home)
    expect(p.home).toBe(home)
    expect(p.serverJson).toBe(join(home, 'server.json'))
    expect(p.dbFile).toBe(join(home, 'state.db'))
    expect(p.sessionsDir).toBe(join(home, 'sessions'))
    expect(p.configFile).toBe(join(home, 'config.json'))
    expect(p.daemonLog).toBe(join(home, 'daemon.log'))
    expect(p.codexHome).toBe(join(home, 'codex-home'))
  })
  it('uses BETTER_REVIEW_HOME env when no arg', () => {
    process.env.BETTER_REVIEW_HOME = home
    expect(resolvePaths().home).toBe(home)
    delete process.env.BETTER_REVIEW_HOME
  })
})
