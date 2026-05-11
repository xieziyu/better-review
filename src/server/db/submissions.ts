import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type { Submission, ReviewEvent } from '../../shared/types'

export interface NewSubmission {
  sessionId: string
  event: ReviewEvent
  githubUrl: string | null
  githubReviewId: number | null
  payloadJson: string
  findingIds: string[]
  error: string | null
}

interface Row {
  id: string
  session_id: string
  event: string
  github_url: string | null
  github_review_id: number | null
  payload_json: string
  finding_ids: string
  submitted_at: number
  error: string | null
}

function rowToSubmission(r: Row): Submission {
  return {
    id: r.id,
    sessionId: r.session_id,
    event: r.event as ReviewEvent,
    githubUrl: r.github_url,
    githubReviewId: r.github_review_id,
    payloadJson: r.payload_json,
    findingIds: JSON.parse(r.finding_ids) as string[],
    submittedAt: r.submitted_at,
    error: r.error,
  }
}

export class SubmissionsRepo {
  constructor(private db: Database.Database) {}

  insert(s: NewSubmission): string {
    const id = randomUUID()
    this.db
      .prepare(
        `
      INSERT INTO submissions (id, session_id, event, github_url, github_review_id, payload_json, finding_ids, submitted_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        id,
        s.sessionId,
        s.event,
        s.githubUrl,
        s.githubReviewId,
        s.payloadJson,
        JSON.stringify(s.findingIds),
        Date.now(),
        s.error,
      )
    return id
  }

  listBySession(sessionId: string): Submission[] {
    const rows = this.db
      .prepare('SELECT * FROM submissions WHERE session_id=? ORDER BY submitted_at DESC')
      .all(sessionId) as Row[]
    return rows.map(rowToSubmission)
  }

  // Most-recent successful submission for a session (error IS NULL). Used by
  // rerun-context.ts to recover the GitHub review id of our prior post.
  latestSuccessfulForSession(sessionId: string): Submission | null {
    const row = this.db
      .prepare(
        'SELECT * FROM submissions WHERE session_id=? AND error IS NULL ORDER BY submitted_at DESC LIMIT 1',
      )
      .get(sessionId) as Row | undefined
    return row ? rowToSubmission(row) : null
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare('DELETE FROM submissions WHERE session_id=?').run(sessionId)
  }
}
