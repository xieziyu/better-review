import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { execa } from 'execa'

import {
  GhCliMissingError,
  GhFileNotFoundError,
  GhFileTooLargeError,
  GhPRNotFoundError,
  GhSubmitError,
} from './errors'
import type { PRTarget } from './pr-target-parser'

// Per-call observation hook scoped via AsyncLocalStorage. When set (by
// `withGhCallRecorder(...)` higher up the call stack), every `gh` invocation
// inside `GhClient` reports its outcome. Outside that scope, the client
// behaves exactly as it always did. The shared `deps.gh` singleton is reused
// across concurrently running sessions, so per-instance state would race —
// ALS scopes correctly across await boundaries.
export interface GhCallRecord {
  command: string[]
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  ts: number
}

type GhCallRecorder = (rec: GhCallRecord) => void

const callRecorder = new AsyncLocalStorage<GhCallRecorder>()

export function withGhCallRecorder<T>(
  recorder: GhCallRecorder,
  fn: () => Promise<T>,
): Promise<T> {
  return callRecorder.run(recorder, fn)
}

export interface PRMeta {
  number: number
  title: string
  author: string | null
  body: string
  url: string
  baseRef: string
  headRef: string
  headSha: string
  baseSha: string
}

export interface DiffResult {
  unifiedDiff: string
}

export interface ReviewComment {
  path: string
  line: number
  body: string
  side?: 'RIGHT' | 'LEFT'
  start_line?: number
  start_side?: 'RIGHT' | 'LEFT'
}
export interface ReviewPayload {
  event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'
  body: string
  comments: ReviewComment[]
}

// Subset of `GET /pulls/:n/reviews` response — only the fields we use.
export interface GhReview {
  id: number
  user: { login: string } | null
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  body: string
  commit_id: string | null
  submitted_at: string | null
  html_url: string
}

// Subset of `GET /pulls/:n/comments` (and review-comments) response.
// `pull_request_review_id` ties an inline comment to the review that posted
// it; `in_reply_to_id` threads replies under their original.
export interface GhReviewComment {
  id: number
  pull_request_review_id: number | null
  user: { login: string } | null
  path: string
  line: number | null
  start_line: number | null
  side: 'RIGHT' | 'LEFT' | null
  start_side: 'RIGHT' | 'LEFT' | null
  commit_id: string | null
  original_commit_id: string | null
  in_reply_to_id: number | null
  body: string
  created_at: string
}

// PR-level (issue) comments — the main conversation thread. Authors often
// reply here ("已修", "不打算改因为…") and we want the agent to see that.
export interface GhIssueComment {
  id: number
  user: { login: string } | null
  body: string
  created_at: string
}

// `GET /repos/:o/:r/compare/:base...:head`. Used to detect force-push
// (status=diverged or behind_by>0) and to extract new hunk ranges that
// landed between the prior review's head and the current head.
export interface GhCompareFile {
  filename: string
  status: string
  patch?: string
}
export interface GhCompare {
  status: 'identical' | 'ahead' | 'behind' | 'diverged'
  ahead_by: number
  behind_by: number
  total_commits: number
  files: GhCompareFile[]
}

// `gh api --paginate` concatenates page bodies. For JSON-array endpoints
// that produces output like `[…][…][…]`. Parse all top-level arrays and
// flatten. Empty stdout → empty list (some endpoints return nothing when
// the list is empty after the first page).
function parseConcatenatedJsonArrays<T>(stdout: string): T[] {
  const out: T[] = []
  const text = stdout.trim()
  if (text.length === 0) return out
  let i = 0
  while (i < text.length) {
    while (i < text.length && text[i] !== '[') i += 1
    if (i >= text.length) break
    let depth = 0
    let inStr = false
    let escape = false
    const start = i
    for (; i < text.length; i += 1) {
      const ch = text[i]
      if (inStr) {
        if (escape) escape = false
        else if (ch === '\\') escape = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') {
        inStr = true
        continue
      }
      if (ch === '[') depth += 1
      else if (ch === ']') {
        depth -= 1
        if (depth === 0) {
          i += 1
          break
        }
      }
    }
    const chunk = text.slice(start, i)
    if (chunk.length > 0) {
      const arr = JSON.parse(chunk) as T[]
      for (const item of arr) out.push(item)
    }
  }
  return out
}

export class GhClient {
  private gh: string
  constructor(opts: { ghPath?: string } = {}) {
    this.gh = opts.ghPath ?? 'gh'
  }

  private async run(
    args: string[],
    opts: { input?: string } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const t0 = Date.now()
    const r =
      opts.input !== undefined
        ? await execa(this.gh, args, { reject: false, input: opts.input })
        : await execa(this.gh, args, { reject: false })
    const stdout = String(r.stdout ?? '')
    const stderr = String(r.stderr ?? '')
    const exitCode = typeof r.exitCode === 'number' ? r.exitCode : null
    const recorder = callRecorder.getStore()
    if (recorder) {
      recorder({
        command: ['gh', ...args],
        stdout,
        stderr,
        exitCode,
        durationMs: Date.now() - t0,
        ts: Date.now(),
      })
    }
    return { stdout, stderr, exitCode }
  }

  async authStatus(): Promise<boolean> {
    try {
      const r = await this.run(['auth', 'status'])
      return r.exitCode === 0
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ENOENT') throw new GhCliMissingError()
      return false
    }
  }

  async prView(t: PRTarget): Promise<PRMeta> {
    const args = [
      'pr',
      'view',
      String(t.number),
      '--repo',
      `${t.owner}/${t.repo}`,
      '--json',
      'number,title,author,body,url,baseRefName,headRefName,baseRefOid,headRefOid',
    ]
    const r = await this.run(args)
    if (r.exitCode !== 0) {
      const txt = String(r.stderr || '') + String(r.stdout || '')
      if (/not found|could not resolve|no .*access|Not Found/i.test(txt)) {
        throw new GhPRNotFoundError(`${t.owner}/${t.repo}#${t.number}`)
      }
      throw new Error(`gh pr view failed: ${txt.slice(0, 500)}`)
    }
    const j = JSON.parse(String(r.stdout))
    return {
      number: j.number,
      title: j.title,
      author: j.author?.login ?? null,
      body: j.body ?? '',
      url: j.url,
      baseRef: j.baseRefName,
      headRef: j.headRefName,
      headSha: j.headRefOid ?? '',
      baseSha: j.baseRefOid ?? '',
    }
  }

  // Fetch a single file's content at a specific git ref via the Contents API.
  // Returns the raw file body. Used by the snapshot path when no local clone
  // is pinned. The Contents API caps at ~1MB per file; larger blobs need the
  // git-blob endpoint, which we surface as a typed error so callers can skip.
  async getFileAtRef(args: {
    owner: string
    repo: string
    path: string
    ref: string
  }): Promise<string> {
    const url = `repos/${args.owner}/${args.repo}/contents/${args.path}?ref=${encodeURIComponent(args.ref)}`
    const r = await this.run(['api', url, '-H', 'Accept: application/vnd.github+json'])
    if (r.exitCode !== 0) {
      const txt = String(r.stderr || '') + String(r.stdout || '')
      if (/HTTP 404|Not Found/i.test(txt)) {
        throw new GhFileNotFoundError(args.path, args.ref)
      }
      if (/too_large|too large|HTTP 403/i.test(txt)) {
        throw new GhFileTooLargeError(args.path)
      }
      throw new Error(`gh api contents failed: ${txt.slice(0, 500)}`)
    }
    let parsed: { type?: string; encoding?: string; content?: string }
    try {
      parsed = JSON.parse(String(r.stdout))
    } catch (e) {
      throw new Error(`gh api contents returned non-JSON: ${(e as Error).message}`, { cause: e })
    }
    if (parsed.type && parsed.type !== 'file') {
      throw new GhFileNotFoundError(args.path, args.ref)
    }
    if (parsed.encoding !== 'base64' || typeof parsed.content !== 'string') {
      // Empty content with encoding=none means GitHub stripped the body for
      // size; treat that as too-large so the caller skips and continues.
      throw new GhFileTooLargeError(args.path)
    }
    return Buffer.from(parsed.content, 'base64').toString('utf8')
  }

  async prDiff(t: PRTarget): Promise<DiffResult> {
    const r = await this.run(['pr', 'diff', String(t.number), '--repo', `${t.owner}/${t.repo}`])
    if (r.exitCode !== 0) throw new Error(`gh pr diff failed: ${String(r.stderr).slice(0, 500)}`)
    return { unifiedDiff: String(r.stdout) }
  }

  // Lists all reviews on a PR. Paginated with --paginate so multi-round
  // PRs return everything. Returns [] on transient failure (the rerun
  // context path treats absence of prior reviews as "no context").
  async listReviews(t: PRTarget): Promise<GhReview[]> {
    const url = `repos/${t.owner}/${t.repo}/pulls/${t.number}/reviews?per_page=100`
    const r = await this.run(['api', '--paginate', url])
    if (r.exitCode !== 0) {
      const txt = String(r.stderr || '') + String(r.stdout || '')
      if (/HTTP 404|Not Found/i.test(txt))
        throw new GhPRNotFoundError(`${t.owner}/${t.repo}#${t.number}`)
      throw new Error(`gh api reviews failed: ${txt.slice(0, 500)}`)
    }
    return parseConcatenatedJsonArrays<GhReview>(String(r.stdout))
  }

  // Lists every PR review comment (inline) including replies. Comments
  // belonging to one review share `pull_request_review_id`; replies point
  // at the original via `in_reply_to_id`. Threading is left to the caller.
  async listAllPRComments(t: PRTarget): Promise<GhReviewComment[]> {
    const url = `repos/${t.owner}/${t.repo}/pulls/${t.number}/comments?per_page=100`
    const r = await this.run(['api', '--paginate', url])
    if (r.exitCode !== 0) {
      const txt = String(r.stderr || '') + String(r.stdout || '')
      if (/HTTP 404|Not Found/i.test(txt))
        throw new GhPRNotFoundError(`${t.owner}/${t.repo}#${t.number}`)
      throw new Error(`gh api pulls comments failed: ${txt.slice(0, 500)}`)
    }
    // GitHub omits `in_reply_to_id` entirely on top-level (non-reply)
    // comments rather than emitting it as null. Normalize to null here so
    // downstream `=== null` predicates correctly identify top-level rows.
    return parseConcatenatedJsonArrays<GhReviewComment>(String(r.stdout)).map((c) => ({
      ...c,
      in_reply_to_id: c.in_reply_to_id ?? null,
    }))
  }

  // PR-level discussion (the issue comments thread). The PR author often
  // replies here ("已修", "不打算改") rather than under each inline thread.
  async listIssueComments(t: PRTarget): Promise<GhIssueComment[]> {
    const url = `repos/${t.owner}/${t.repo}/issues/${t.number}/comments?per_page=100`
    const r = await this.run(['api', '--paginate', url])
    if (r.exitCode !== 0) {
      const txt = String(r.stderr || '') + String(r.stdout || '')
      if (/HTTP 404|Not Found/i.test(txt))
        throw new GhPRNotFoundError(`${t.owner}/${t.repo}#${t.number}`)
      throw new Error(`gh api issue comments failed: ${txt.slice(0, 500)}`)
    }
    return parseConcatenatedJsonArrays<GhIssueComment>(String(r.stdout))
  }

  // `GET /repos/:o/:r/compare/:base...:head`. Caller uses `status` to
  // detect force-push and `files[*].patch` to extract new hunks. The diff
  // we feed the agent always remains the full base..head; this is only
  // used to annotate which hunks are NEW since the last review.
  async compareCommits(
    t: { owner: string; repo: string },
    base: string,
    head: string,
  ): Promise<GhCompare> {
    const url = `repos/${t.owner}/${t.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`
    const r = await this.run(['api', url, '-H', 'Accept: application/vnd.github+json'])
    if (r.exitCode !== 0) {
      const txt = String(r.stderr || '') + String(r.stdout || '')
      // 404 here usually means the base sha is no longer reachable (force
      // push). Surface a typed error so rerun-context can degrade to "no
      // increment, treat all as new".
      if (/HTTP 404|Not Found|No common ancestor/i.test(txt)) {
        throw new GhFileNotFoundError(`compare/${base}...${head}`, head)
      }
      throw new Error(`gh api compare failed: ${txt.slice(0, 500)}`)
    }
    const j = JSON.parse(String(r.stdout)) as {
      status: GhCompare['status']
      ahead_by: number
      behind_by: number
      total_commits: number
      files?: GhCompareFile[]
    }
    return {
      status: j.status,
      ahead_by: j.ahead_by,
      behind_by: j.behind_by,
      total_commits: j.total_commits,
      files: j.files ?? [],
    }
  }

  async submitReview(
    t: PRTarget,
    payload: ReviewPayload,
  ): Promise<{ html_url: string; id: number }> {
    const tmpFile = join(tmpdir(), `br-payload-${randomUUID()}.json`)
    writeFileSync(tmpFile, JSON.stringify(payload))
    const r = await this.run([
      'api',
      `repos/${t.owner}/${t.repo}/pulls/${t.number}/reviews`,
      '-X',
      'POST',
      '--input',
      tmpFile,
    ])
    if (r.exitCode !== 0) throw new GhSubmitError(String(r.stderr || 'unknown'))
    const j = JSON.parse(String(r.stdout))
    return { html_url: j.html_url, id: j.id }
  }
}
