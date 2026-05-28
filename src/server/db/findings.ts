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
  // The two columns below are present only on rows returned by list/getById
  // (which JOIN the submitted state in). Inserts construct findings without
  // these and explicitly set null on the resulting Finding.
  submitted_at: number | null
  submitted_comment_id: number | null
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
    submittedAt: r.submitted_at,
    submittedCommentId: r.submitted_comment_id,
  }
  if (r.suggestion !== null) f.suggestion = r.suggestion
  if (r.start_line !== null) f.startLine = r.start_line
  return f
}

// SELECT fragment shared by listBySession / getById. Computes:
//  - submitted_at: earliest non-error submission that included this finding
//    (sticky once set, even if the user later re-selects + re-submits).
//  - submitted_comment_id: most recent submission_comments row with a known
//    github_comment_id for this finding. Null when only ever drop-to-body
//    or when the comment back-fetch missed.
const FINDING_SELECT = `
  f.*,
  (
    SELECT MIN(s.submitted_at) FROM submissions s
    WHERE s.session_id = f.session_id
      AND s.error IS NULL
      AND EXISTS (
        SELECT 1 FROM json_each(s.finding_ids) je WHERE je.value = f.id
      )
  ) AS submitted_at,
  (
    SELECT sc.github_comment_id FROM submission_comments sc
    JOIN submissions s ON s.id = sc.submission_id
    WHERE sc.finding_db_id = f.id
      AND sc.github_comment_id IS NOT NULL
      AND s.error IS NULL
    ORDER BY sc.created_at DESC LIMIT 1
  ) AS submitted_comment_id
`

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
          submittedAt: null,
          submittedCommentId: null,
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
    const where = opts.includeArchived ? 'f.session_id=?' : 'f.session_id=? AND f.archived=0'
    const rows = this.db
      .prepare(`SELECT ${FINDING_SELECT} FROM findings f WHERE ${where} ORDER BY f.ord ASC`)
      .all(sessionId) as Row[]
    return rows.map((r) => rowToFinding(r, 'R' + r.ord))
  }

  getById(dbId: string): Finding | null {
    const r = this.db.prepare(`SELECT ${FINDING_SELECT} FROM findings f WHERE f.id=?`).get(dbId) as
      | Row
      | undefined
    return r ? rowToFinding(r, 'R' + r.ord) : null
  }

  update(dbId: string, patch: UpdateFindingPatch): void {
    const cur = this.getById(dbId)
    if (!cur) return
    const next = { ...cur, ...patch }
    // File-level findings (line === null) render into the review body, where
    // a `suggestion` fenced block isn't actionable on GitHub and would just
    // be a misleading code block. Drop it at the boundary so direct PATCH
    // hits can't smuggle one in around the form.
    const suggestion = next.line === null ? null : (next.suggestion ?? null)
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
        suggestion,
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
