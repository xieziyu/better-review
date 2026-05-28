import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type { FindingFromAgent, ManualFindingInput } from '../../shared/findings-schema'
import type { Finding, FindingSource } from '../../shared/types'

interface Row {
  id: string
  session_id: string
  ord: number
  severity: string
  category: string
  file: string | null
  line: number | null
  start_line: number | null
  title: string
  body: string
  suggestion: string | null
  selected: number
  edited: number
  archived: number
  created_at: number
  source: string | null
}

function rowToFinding(r: Row, agentId: string): Finding {
  const f: Finding = {
    dbId: r.id,
    sessionId: r.session_id,
    id: agentId,
    ord: r.ord,
    severity: r.severity as Finding['severity'],
    category: r.category,
    file: r.file,
    line: r.line,
    title: r.title,
    body: r.body,
    selected: r.selected === 1,
    edited: r.edited === 1,
    archived: r.archived === 1,
    createdAt: r.created_at,
    source: (r.source as FindingSource | null) ?? 'agent',
  }
  if (r.suggestion !== null) f.suggestion = r.suggestion
  if (r.start_line !== null) f.startLine = r.start_line
  return f
}

export interface UpdateFindingPatch {
  severity?: Finding['severity']
  title?: string
  body?: string
  suggestion?: string | null
  file?: string | null
  line?: number | null
  startLine?: number | null
}

export class FindingsRepo {
  constructor(private db: Database.Database) {}

  insertMany(
    sessionId: string,
    items: FindingFromAgent[],
    source: FindingSource = 'agent',
  ): Finding[] {
    const now = Date.now()
    const insert = this.db.prepare(`
      INSERT INTO findings (id, session_id, ord, severity, category, file, line, start_line, title, body, suggestion, selected, edited, archived, created_at, source)
      VALUES (@id, @sessionId, @ord, @severity, @category, @file, @line, @startLine, @title, @body, @suggestion, 1, 0, 0, @now, @source)
    `)
    const inserted: Finding[] = []
    this.db.transaction(() => {
      const existingMax = (
        this.db
          .prepare(
            'SELECT COALESCE(MAX(ord), 0) AS m FROM findings WHERE session_id=? AND archived=0',
          )
          .get(sessionId) as { m: number }
      ).m
      items.forEach((it, i) => {
        const dbId = randomUUID()
        const ord = existingMax + i + 1
        insert.run({
          id: dbId,
          sessionId,
          ord,
          severity: it.severity,
          category: it.category,
          file: it.file,
          line: it.line,
          startLine: it.startLine ?? null,
          title: it.title,
          body: it.body,
          suggestion: it.suggestion ?? null,
          now,
          source,
        })
        const f: Finding = {
          dbId,
          sessionId,
          id: it.id,
          ord,
          severity: it.severity,
          category: it.category,
          file: it.file,
          line: it.line,
          title: it.title,
          body: it.body,
          selected: true,
          edited: false,
          archived: false,
          createdAt: now,
          source,
        }
        if (it.suggestion !== undefined) f.suggestion = it.suggestion
        if (it.startLine !== undefined) f.startLine = it.startLine
        inserted.push(f)
      })
    })()
    return inserted
  }

  // Insert one user-authored finding. Manual findings always carry a file
  // (guaranteed by manualFindingInputSchema); `line` is optional — omit it
  // for a file-level finding. We get a synthetic agent-side id for parity
  // with agent-produced rows.
  insertManual(sessionId: string, input: ManualFindingInput): Finding {
    const agentId = 'M' + randomUUID().slice(0, 8)
    const item: FindingFromAgent = {
      id: agentId,
      severity: input.severity,
      category: input.category,
      file: input.file,
      line: input.line ?? null,
      title: input.title,
      body: input.body,
    }
    if (input.startLine !== undefined) item.startLine = input.startLine
    if (input.suggestion !== undefined) item.suggestion = input.suggestion
    const inserted = this.insertMany(sessionId, [item], 'manual')[0]
    if (!inserted) {
      throw new Error(`insertManual failed for session ${sessionId}`)
    }
    return inserted
  }

  listBySession(sessionId: string, opts: { includeArchived?: boolean } = {}): Finding[] {
    const where = opts.includeArchived ? 'session_id=?' : 'session_id=? AND archived=0'
    const rows = this.db
      .prepare(`SELECT * FROM findings WHERE ${where} ORDER BY ord ASC`)
      .all(sessionId) as Row[]
    return rows.map((r) => rowToFinding(r, 'R' + r.ord))
  }

  getById(dbId: string): Finding | null {
    const r = this.db.prepare('SELECT * FROM findings WHERE id=?').get(dbId) as Row | undefined
    return r ? rowToFinding(r, 'R' + r.ord) : null
  }

  update(dbId: string, patch: UpdateFindingPatch): void {
    const cur = this.getById(dbId)
    if (!cur) return
    const next = { ...cur, ...patch }
    this.db
      .prepare(
        `
      UPDATE findings SET severity=?, title=?, body=?, suggestion=?, file=?, line=?, start_line=?, edited=1
      WHERE id=?
    `,
      )
      .run(
        next.severity,
        next.title,
        next.body,
        next.suggestion ?? null,
        next.file,
        next.line,
        next.startLine ?? null,
        dbId,
      )
  }

  setSelected(dbId: string, selected: boolean): void {
    this.db.prepare('UPDATE findings SET selected=? WHERE id=?').run(selected ? 1 : 0, dbId)
  }

  setArchived(dbId: string, archived: boolean): void {
    this.db.prepare('UPDATE findings SET archived=? WHERE id=?').run(archived ? 1 : 0, dbId)
  }

  archiveAllForSession(sessionId: string): void {
    this.db
      .prepare('UPDATE findings SET archived=1 WHERE session_id=? AND archived=0')
      .run(sessionId)
  }

  delete(dbId: string): void {
    this.db.prepare('DELETE FROM findings WHERE id=?').run(dbId)
  }
}
