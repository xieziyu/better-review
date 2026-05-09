import type Database from 'better-sqlite3'

import type {
  AgentKind,
  PRSession,
  RecentRepo,
  SessionStatus,
  SourceKind,
} from '../../shared/types'

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
  localRepoPath: string | null
  // Source-kind columns are optional on input — callers that don't yet
  // resolve a source tree (older paths, unit tests) get NULL stored, which
  // is read back as `kind: null` and treated as diff-only at the UI layer.
  sourceKind?: SourceKind | null
  sourceRefName?: string | null
  promptUsed: string
  extraPrompt?: string | null
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
  local_repo_path: string | null
  source_kind: string | null
  source_ref_name: string | null
  prompt_used: string
  extra_prompt: string | null
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
    localRepoPath: r.local_repo_path,
    sourceKind: (r.source_kind as SourceKind | null) ?? null,
    sourceRefName: r.source_ref_name,
    promptUsed: r.prompt_used,
    extraPrompt: r.extra_prompt,
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
         status, agent, created_at, updated_at, workdir, local_repo_path,
         source_kind, source_ref_name, prompt_used, extra_prompt, error)
      VALUES (@id, @owner, @repo, @number, @title, @author, @url, @baseRef, @headRef,
              @status, @agent, @now, @now, @workdir, @localRepoPath,
              @sourceKind, @sourceRefName, @promptUsed, @extraPrompt, NULL)
    `,
      )
      .run({
        ...s,
        sourceKind: s.sourceKind ?? null,
        sourceRefName: s.sourceRefName ?? null,
        extraPrompt: s.extraPrompt ?? null,
        now,
      })
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

  recentRepos(filter: { owner: string; repo: string }, limit: number): RecentRepo[] {
    const rows = this.db
      .prepare(
        `
        SELECT local_repo_path AS path,
               MAX(updated_at)  AS lastUsedAt,
               COUNT(*)         AS useCount,
               CASE WHEN SUM(CASE WHEN owner=@owner AND repo=@repo THEN 1 ELSE 0 END) > 0
                    THEN 1 ELSE 0 END AS matchedCurrentRepo
        FROM pr_sessions
        WHERE local_repo_path IS NOT NULL
        GROUP BY local_repo_path
        ORDER BY matchedCurrentRepo DESC, lastUsedAt DESC
        LIMIT @limit
      `,
      )
      .all({ owner: filter.owner, repo: filter.repo, limit }) as Array<{
      path: string
      lastUsedAt: number
      useCount: number
      matchedCurrentRepo: number
    }>
    return rows.map((r) => ({
      path: r.path,
      lastUsedAt: r.lastUsedAt,
      useCount: r.useCount,
      matchedCurrentRepo: r.matchedCurrentRepo === 1,
    }))
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
