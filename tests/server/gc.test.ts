import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { openDatabase } from '../../src/server/db/connection'
import { SessionsRepo } from '../../src/server/db/sessions'
import { SubmissionsRepo } from '../../src/server/db/submissions'
import { makeDeleteSession } from '../../src/server/delete-session'
import { ConcurrencyQueue } from '../../src/server/engine/queue'
import { RunnerRegistry } from '../../src/server/engine/runner-registry'
import { makeGCSessions } from '../../src/server/gc'
import type { Logger } from '../../src/server/logger'
import type { SessionStatus } from '../../src/shared/types'

const DAY_MS = 86_400_000

function silentLogger(): Logger {
  return { info: () => {}, warn: () => {}, error: () => {} }
}

function setupDb(): { db: Database.Database; sessions: SessionsRepo } {
  const dir = mkdtempSync(join(tmpdir(), 'br-gc-'))
  const db = openDatabase(join(dir, 's.db'))
  return { db, sessions: new SessionsRepo(db) }
}

function insertSession(
  db: Database.Database,
  id: string,
  status: SessionStatus,
  updatedAt: number,
  workdir = '/tmp/nonexistent',
): void {
  db.prepare(
    `INSERT INTO pr_sessions (id, owner, repo, number, title, author, url, base_ref, head_ref,
      status, agent, created_at, updated_at, workdir, prompt_used, error)
     VALUES (?, 'o', 'r', 1, NULL, NULL, NULL, NULL, NULL, ?, 'claude', ?, ?, ?, 'p', NULL)`,
  ).run(id, status, updatedAt, updatedAt, workdir)
}

describe('gcSessions', () => {
  it('deletes only terminal sessions older than cutoff', async () => {
    const { db, sessions } = setupDb()
    const now = Date.UTC(2026, 0, 30)
    const old = now - 10 * DAY_MS
    const fresh = now - 1 * DAY_MS

    insertSession(db, 'old-ready', 'ready', old)
    insertSession(db, 'old-running', 'running', old)
    insertSession(db, 'fresh-ready', 'ready', fresh)

    const calls: string[] = []
    const gc = makeGCSessions({
      sessions,
      deleteSession: async (id) => {
        calls.push(id)
      },
      perPRGCDays: 7,
      log: silentLogger(),
      now: () => now,
    })

    const res = await gc()
    expect(res.deleted).toEqual(['old-ready'])
    expect(res.skipped).toBe(2)
    expect(calls).toEqual(['old-ready'])
  })

  it('returns empty result when perPRGCDays <= 0 (disabled)', async () => {
    const { db, sessions } = setupDb()
    insertSession(db, 's1', 'ready', 0)

    let called = 0
    const gc = makeGCSessions({
      sessions,
      deleteSession: async () => {
        called++
      },
      perPRGCDays: 0,
      log: silentLogger(),
      now: () => Date.now(),
    })

    const res = await gc()
    expect(res).toEqual({ deleted: [], skipped: 0 })
    expect(called).toBe(0)
  })

  it('continues after deleteSession throws on one entry', async () => {
    const { db, sessions } = setupDb()
    const now = Date.UTC(2026, 0, 30)
    const old = now - 10 * DAY_MS

    insertSession(db, 'a', 'ready', old)
    insertSession(db, 'b', 'failed', old)
    insertSession(db, 'c', 'submitted', old)

    const gc = makeGCSessions({
      sessions,
      deleteSession: async (id) => {
        if (id === 'b') throw new Error('boom')
      },
      perPRGCDays: 7,
      log: silentLogger(),
      now: () => now,
    })

    const res = await gc()
    expect(res.deleted).toEqual(['a', 'c'])
    expect(res.skipped).toBe(0)
  })

  it('filters by status: keeps running/pending, deletes other terminals', async () => {
    const { db, sessions } = setupDb()
    const now = Date.UTC(2026, 0, 30)
    const old = now - 10 * DAY_MS

    insertSession(db, 'running', 'running', old)
    insertSession(db, 'pending', 'pending', old)
    insertSession(db, 'ready', 'ready', old)
    insertSession(db, 'failed', 'failed', old)
    insertSession(db, 'cancelled', 'cancelled', old)
    insertSession(db, 'submitted', 'submitted', old)
    insertSession(db, 'archived', 'archived', old)

    const calls: string[] = []
    const gc = makeGCSessions({
      sessions,
      deleteSession: async (id) => {
        calls.push(id)
      },
      perPRGCDays: 7,
      log: silentLogger(),
      now: () => now,
    })

    const res = await gc()
    expect(res.deleted.sort()).toEqual(['archived', 'cancelled', 'failed', 'ready', 'submitted'])
    expect(res.skipped).toBe(2)
    expect(calls.sort()).toEqual(['archived', 'cancelled', 'failed', 'ready', 'submitted'])
  })

  it('honors injected now() to control cutoff', async () => {
    const { db, sessions } = setupDb()
    const now = Date.UTC(2026, 0, 30)

    insertSession(db, 'six-day', 'ready', now - 6 * DAY_MS)
    insertSession(db, 'eight-day', 'ready', now - 8 * DAY_MS)

    const gc = makeGCSessions({
      sessions,
      deleteSession: async () => {},
      perPRGCDays: 7,
      log: silentLogger(),
      now: () => now,
    })

    const res = await gc()
    expect(res.deleted).toEqual(['eight-day'])
    expect(res.skipped).toBe(1)
  })

  it('end-to-end: real deleteSession removes workdir and DB row', async () => {
    const root = mkdtempSync(join(tmpdir(), 'br-gc-e2e-'))
    const sessionsDir = join(root, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    const db = openDatabase(join(root, 's.db'))
    const sessions = new SessionsRepo(db)
    const submissions = new SubmissionsRepo(db)
    const queue = new ConcurrencyQueue(1)
    const runners = new RunnerRegistry()
    const deleteSession = makeDeleteSession({
      db,
      sessions,
      submissions,
      queue,
      runners,
      sessionsDir,
    })

    const workdir = join(sessionsDir, 'pr-foo-bar-1-deadbeef')
    mkdirSync(workdir)
    writeFileSync(join(workdir, 'findings.json'), '[]')

    const now = Date.UTC(2026, 0, 30)
    const old = now - 8 * DAY_MS
    insertSession(db, 's1', 'ready', old, workdir)

    const gc = makeGCSessions({
      sessions,
      deleteSession,
      perPRGCDays: 7,
      log: silentLogger(),
      now: () => now,
    })

    const res = await gc()
    expect(res.deleted).toEqual(['s1'])
    expect(sessions.getById('s1')).toBeNull()
    expect(existsSync(workdir)).toBe(false)
  })
})
