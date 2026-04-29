import type Database from 'better-sqlite3'

import type { AgentKind, PRSession, SessionStatus } from '../../shared/types'

export interface NewSessionInput {
  id: string
  owner: string
  repo: string
  number: number
  title: string | null
  author: string | null
  url: string | null
  baseRef: string | null
  headRef: string | null
  status: SessionStatus
  agent: AgentKind
  workdir: string
  promptUsed: string
}

interface Row {
  id: string
  owner: string
  repo: string
  number: number
  title: string | null
  author: string | null
  url: string | null
  base_ref: string | null
  head_ref: string | null
  status: string
  agent: string
  created_at: number
  updated_at: number
  workdir: string
  prompt_used: string
  error: string | null
}

function rowToSession(r: Row): PRSession {
  return {
    id: r.id,
    owner: r.owner,
    repo: r.repo,
    number: r.number,
    title: r.title,
    author: r.author,
    url: r.url,
    baseRef: r.base_ref,
    headRef: r.head_ref,
    status: r.status as SessionStatus,
    agent: (r.agent as AgentKind) ?? 'claude',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    workdir: r.workdir,
    promptUsed: r.prompt_used,
    error: r.error,
  }
}

export class SessionsRepo {
  constructor(private db: Database.Database) {}

  insert(s: NewSessionInput): void {
    const now = Date.now()
    this.db
      .prepare(
        `
      INSERT INTO pr_sessions
        (id, owner, repo, number, title, author, url, base_ref, head_ref,
         status, agent, created_at, updated_at, workdir, prompt_used, error)
      VALUES (@id, @owner, @repo, @number, @title, @author, @url, @baseRef, @headRef,
              @status, @agent, @now, @now, @workdir, @promptUsed, NULL)
    `,
      )
      .run({ ...s, now })
  }

  getById(id: string): PRSession | null {
    const row = this.db.prepare('SELECT * FROM pr_sessions WHERE id=?').get(id) as Row | undefined
    return row ? rowToSession(row) : null
  }

  list(): PRSession[] {
    const rows = this.db
      .prepare('SELECT * FROM pr_sessions ORDER BY created_at DESC')
      .all() as Row[]
    return rows.map(rowToSession)
  }

  findActiveByPR(owner: string, repo: string, number: number): PRSession | null {
    const row = this.db
      .prepare(
        "SELECT * FROM pr_sessions WHERE owner=? AND repo=? AND number=? AND status != 'archived' ORDER BY created_at DESC LIMIT 1",
      )
      .get(owner, repo, number) as Row | undefined
    return row ? rowToSession(row) : null
  }

  setStatus(id: string, status: SessionStatus): void {
    this.db
      .prepare('UPDATE pr_sessions SET status=?, updated_at=? WHERE id=?')
      .run(status, Date.now(), id)
  }

  setError(id: string, error: string | null): void {
    this.db
      .prepare('UPDATE pr_sessions SET error=?, updated_at=? WHERE id=?')
      .run(error, Date.now(), id)
  }

  updateWorkdir(id: string, workdir: string, promptUsed: string): void {
    this.db
      .prepare('UPDATE pr_sessions SET workdir=?, prompt_used=?, updated_at=? WHERE id=?')
      .run(workdir, promptUsed, Date.now(), id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM pr_sessions WHERE id=?').run(id)
  }
}
