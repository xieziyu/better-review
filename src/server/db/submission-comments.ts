import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'

import type { SubmissionComment } from '../../shared/types'

export interface NewSubmissionComment {
  findingDbId: string | null
  githubCommentId: number | null
  file: string | null
  line: number | null
  startLine: number | null
  title: string
  body: string
}

interface Row {
  id: string
  submission_id: string
  finding_db_id: string | null
  github_comment_id: number | null
  file: string | null
  line: number | null
  start_line: number | null
  title: string
  body: string
  created_at: number
}

function rowToSubmissionComment(r: Row): SubmissionComment {
  return {
    id: r.id,
    submissionId: r.submission_id,
    findingDbId: r.finding_db_id,
    githubCommentId: r.github_comment_id,
    file: r.file,
    line: r.line,
    startLine: r.start_line,
    title: r.title,
    body: r.body,
    createdAt: r.created_at,
  }
}

export class SubmissionCommentsRepo {
  constructor(private db: Database.Database) {}

  insertMany(submissionId: string, items: NewSubmissionComment[]): void {
    if (items.length === 0) return
    const now = Date.now()
    const stmt = this.db.prepare(`
      INSERT INTO submission_comments
        (id, submission_id, finding_db_id, github_comment_id, file, line, start_line, title, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.db.transaction(() => {
      for (const it of items) {
        stmt.run(
          randomUUID(),
          submissionId,
          it.findingDbId,
          it.githubCommentId,
          it.file,
          it.line,
          it.startLine,
          it.title,
          it.body,
          now,
        )
      }
    })()
  }

  listBySubmission(submissionId: string): SubmissionComment[] {
    const rows = this.db
      .prepare('SELECT * FROM submission_comments WHERE submission_id=? ORDER BY created_at ASC')
      .all(submissionId) as Row[]
    return rows.map(rowToSubmissionComment)
  }

  // All inline comments we ever posted for a PR, across sessions+submissions.
  // Drives submit-layer dedup: skip proposed comments that already exist.
  // Joins through submissions → pr_sessions and keeps only error-free
  // submissions with at least one comment row.
  listByPR(owner: string, repo: string, number: number): SubmissionComment[] {
    const rows = this.db
      .prepare(
        `
        SELECT sc.* FROM submission_comments sc
        JOIN submissions s ON s.id = sc.submission_id
        JOIN pr_sessions p ON p.id = s.session_id
        WHERE p.owner=? AND p.repo=? AND p.number=? AND s.error IS NULL
        ORDER BY sc.created_at ASC
      `,
      )
      .all(owner, repo, number) as Row[]
    return rows.map(rowToSubmissionComment)
  }
}
