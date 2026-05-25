// Verifies migration 0010 backfills `source_json` to the exact same string
// `serializeSource()` would produce for an equivalent SessionSource. This
// guards against SQLite's `json_object` ever emitting keys in a different
// order than our TypeScript canonical serializer.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { SessionsRepo } from '../../../src/server/db/sessions'
import { serializeSource, type SessionSource } from '../../../src/shared/source'

describe('migration 0010 — session_source backfill', () => {
  it('backfilled source_json matches serializeSource() exactly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-source-mig-'))
    const db = openDatabase(join(dir, 's.db'))

    // Simulate an "old" row: insert directly against the table without
    // going through SessionsRepo so we can null out source_json and have
    // the migration backfill it. (openDatabase already ran the migration,
    // so the column exists — we just blank it.)
    const now = Date.now()
    db.prepare(
      `INSERT INTO pr_sessions
        (id, owner, repo, number, status, agent, created_at, updated_at,
         workdir, prompt_used, source_json)
       VALUES ('legacy', 'acme', 'web', 42, 'ready', 'codex', ?, ?, '/w', '', NULL)`,
    ).run(now, now)

    // Re-run the same UPDATE the migration uses (idempotent — only NULLs
    // are touched). In a real upgrade this runs once at startup.
    db.exec(
      `UPDATE pr_sessions
          SET source_json = json_object('kind','github-pr','owner',owner,'repo',repo,'number',number)
        WHERE source_json IS NULL`,
    )

    const row = db.prepare('SELECT source_json FROM pr_sessions WHERE id=?').get('legacy') as {
      source_json: string
    }
    const expected: SessionSource = {
      kind: 'github-pr',
      owner: 'acme',
      repo: 'web',
      number: 42,
    }
    expect(row.source_json).toBe(serializeSource(expected))

    // And SessionsRepo reads it back as the same SessionSource.
    const session = new SessionsRepo(db).getById('legacy')!
    expect(session.source).toEqual(expected)
  })
})
