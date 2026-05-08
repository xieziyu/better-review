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

export class GhClient {
  private gh: string
  constructor(opts: { ghPath?: string } = {}) {
    this.gh = opts.ghPath ?? 'gh'
  }

  async authStatus(): Promise<boolean> {
    try {
      const r = await execa(this.gh, ['auth', 'status'], { reject: false })
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
    const r = await execa(this.gh, args, { reject: false })
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
    const r = await execa(this.gh, ['api', url, '-H', 'Accept: application/vnd.github+json'], {
      reject: false,
    })
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
    const r = await execa(
      this.gh,
      ['pr', 'diff', String(t.number), '--repo', `${t.owner}/${t.repo}`],
      { reject: false },
    )
    if (r.exitCode !== 0) throw new Error(`gh pr diff failed: ${String(r.stderr).slice(0, 500)}`)
    return { unifiedDiff: String(r.stdout) }
  }

  async submitReview(
    t: PRTarget,
    payload: ReviewPayload,
  ): Promise<{ html_url: string; id: number }> {
    const tmpFile = join(tmpdir(), `br-payload-${randomUUID()}.json`)
    writeFileSync(tmpFile, JSON.stringify(payload))
    const r = await execa(
      this.gh,
      [
        'api',
        `repos/${t.owner}/${t.repo}/pulls/${t.number}/reviews`,
        '-X',
        'POST',
        '--input',
        tmpFile,
      ],
      { reject: false },
    )
    if (r.exitCode !== 0) throw new GhSubmitError(String(r.stderr || 'unknown'))
    const j = JSON.parse(String(r.stdout))
    return { html_url: j.html_url, id: j.id }
  }
}
