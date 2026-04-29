import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { execa } from 'execa'

import { GhCliMissingError, GhPRNotFoundError, GhSubmitError } from './errors'
import type { PRTarget } from './pr-target-parser'

export interface PRMeta {
  number: number
  title: string
  author: string | null
  body: string
  url: string
  baseRef: string
  headRef: string
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
      'number,title,author,body,url,baseRefName,headRefName',
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
    }
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
