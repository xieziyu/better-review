import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeEach } from 'vitest'

import {
  GhFileNotFoundError,
  GhPRNotFoundError,
  GhSubmitError,
} from '../../../src/server/github/errors'
import { GhClient } from '../../../src/server/github/gh-client'

const here = dirname(fileURLToPath(import.meta.url))
const FAKE = resolve(here, '../../fixtures/fake-gh.sh')

describe('GhClient', () => {
  beforeEach(() => {
    delete process.env.FAKE_GH_AUTHED
    delete process.env.FAKE_GH_NOTFOUND
    delete process.env.FAKE_GH_SUBMIT_FAIL
    delete process.env.FAKE_GH_HEAD_OID
    delete process.env.FAKE_GH_BASE_OID
    delete process.env.FAKE_GH_CONTENTS_DIR
    delete process.env.FAKE_GH_REVIEWS_FILE
    delete process.env.FAKE_GH_PR_COMMENTS_FILE
    delete process.env.FAKE_GH_ISSUE_COMMENTS_FILE
    delete process.env.FAKE_GH_COMPARE_FILE
    delete process.env.FAKE_GH_COMPARE_NOTFOUND
    delete process.env.FAKE_GH_REVIEW_ID
  })

  it('authStatus true when fake gh succeeds', async () => {
    const c = new GhClient({ ghPath: FAKE })
    expect(await c.authStatus()).toBe(true)
  })

  it('authStatus false when env says not logged in', async () => {
    process.env.FAKE_GH_AUTHED = '0'
    const c = new GhClient({ ghPath: FAKE })
    expect(await c.authStatus()).toBe(false)
  })

  it('prView returns parsed PRMeta including head/base SHAs', async () => {
    const c = new GhClient({ ghPath: FAKE })
    const meta = await c.prView({ owner: 'o', repo: 'r', number: 1 })
    expect(meta.title).toBe('Title')
    expect(meta.author).toBe('alice')
    expect(meta.baseRef).toBe('main')
    // The fake shim emits a default deterministic SHA shape unless overridden.
    expect(meta.headSha).toMatch(/^[0-9a-f]{40}$/)
    expect(meta.baseSha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('prView throws GhPRNotFoundError when fake says missing', async () => {
    process.env.FAKE_GH_NOTFOUND = '1'
    const c = new GhClient({ ghPath: FAKE })
    await expect(c.prView({ owner: 'o', repo: 'r', number: 1 })).rejects.toBeInstanceOf(
      GhPRNotFoundError,
    )
  })

  it('prDiff returns unifiedDiff string', async () => {
    const c = new GhClient({ ghPath: FAKE })
    const d = await c.prDiff({ owner: 'o', repo: 'r', number: 1 })
    expect(d.unifiedDiff).toContain('diff --git')
  })

  it('submitReview returns html_url', async () => {
    const c = new GhClient({ ghPath: FAKE })
    const r = await c.submitReview(
      { owner: 'o', repo: 'r', number: 1 },
      { event: 'COMMENT', body: 'hi', comments: [] },
    )
    expect(r.html_url).toContain('pullrequestreview')
  })

  it('getFileAtRef returns the decoded file body for an existing path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'br-gh-contents-'))
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/x.ts'), 'export const x = 1\n')
    process.env.FAKE_GH_CONTENTS_DIR = root
    const c = new GhClient({ ghPath: FAKE })
    const body = await c.getFileAtRef({ owner: 'o', repo: 'r', path: 'src/x.ts', ref: 'abc' })
    expect(body).toBe('export const x = 1\n')
  })

  it('getFileAtRef throws GhFileNotFoundError when the path is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'br-gh-contents-'))
    process.env.FAKE_GH_CONTENTS_DIR = root
    const c = new GhClient({ ghPath: FAKE })
    await expect(
      c.getFileAtRef({ owner: 'o', repo: 'r', path: 'nope.ts', ref: 'abc' }),
    ).rejects.toBeInstanceOf(GhFileNotFoundError)
  })

  it('submitReview throws GhSubmitError on failure', async () => {
    process.env.FAKE_GH_SUBMIT_FAIL = '1'
    const c = new GhClient({ ghPath: FAKE })
    await expect(
      c.submitReview(
        { owner: 'o', repo: 'r', number: 1 },
        { event: 'COMMENT', body: 'x', comments: [] },
      ),
    ).rejects.toBeInstanceOf(GhSubmitError)
  })

  it('listReviews returns [] when fixture is unset', async () => {
    const c = new GhClient({ ghPath: FAKE })
    expect(await c.listReviews({ owner: 'o', repo: 'r', number: 1 })).toEqual([])
  })

  it('listReviews parses a fixture file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-rev-'))
    const f = join(dir, 'reviews.json')
    writeFileSync(
      f,
      JSON.stringify([
        {
          id: 42,
          user: { login: 'me' },
          state: 'COMMENTED',
          body: 'overall',
          commit_id: 'abc',
          submitted_at: '2026-05-01T00:00:00Z',
          html_url: 'https://github.com/o/r/pull/1#pullrequestreview-42',
        },
      ]),
    )
    process.env.FAKE_GH_REVIEWS_FILE = f
    const c = new GhClient({ ghPath: FAKE })
    const rs = await c.listReviews({ owner: 'o', repo: 'r', number: 1 })
    expect(rs).toHaveLength(1)
    expect(rs[0]!.id).toBe(42)
    expect(rs[0]!.commit_id).toBe('abc')
  })

  it('listAllPRComments parses a fixture file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-cm-'))
    const f = join(dir, 'comments.json')
    writeFileSync(
      f,
      JSON.stringify([
        {
          id: 1,
          pull_request_review_id: 42,
          user: { login: 'me' },
          path: 'a.ts',
          line: 5,
          start_line: null,
          side: 'RIGHT',
          start_side: null,
          commit_id: 'abc',
          original_commit_id: 'abc',
          in_reply_to_id: null,
          body: 'top',
          created_at: '2026-05-01T00:00:00Z',
        },
        {
          id: 2,
          pull_request_review_id: null,
          user: { login: 'alice' },
          path: 'a.ts',
          line: 5,
          start_line: null,
          side: 'RIGHT',
          start_side: null,
          commit_id: 'abc',
          original_commit_id: 'abc',
          in_reply_to_id: 1,
          body: 'reply from author',
          created_at: '2026-05-02T00:00:00Z',
        },
      ]),
    )
    process.env.FAKE_GH_PR_COMMENTS_FILE = f
    const c = new GhClient({ ghPath: FAKE })
    const cs = await c.listAllPRComments({ owner: 'o', repo: 'r', number: 1 })
    expect(cs).toHaveLength(2)
    expect(cs[1]!.in_reply_to_id).toBe(1)
  })

  it('listIssueComments parses a fixture file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-ic-'))
    const f = join(dir, 'issues.json')
    writeFileSync(
      f,
      JSON.stringify([
        { id: 100, user: { login: 'alice' }, body: '已修', created_at: '2026-05-02T00:00:00Z' },
      ]),
    )
    process.env.FAKE_GH_ISSUE_COMMENTS_FILE = f
    const c = new GhClient({ ghPath: FAKE })
    const ics = await c.listIssueComments({ owner: 'o', repo: 'r', number: 1 })
    expect(ics).toHaveLength(1)
    expect(ics[0]!.body).toBe('已修')
  })

  it('compareCommits parses status + files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-cmp-'))
    const f = join(dir, 'compare.json')
    writeFileSync(
      f,
      JSON.stringify({
        status: 'ahead',
        ahead_by: 2,
        behind_by: 0,
        total_commits: 2,
        files: [{ filename: 'a.ts', status: 'modified', patch: '@@ -1,1 +1,2 @@\n a\n+b\n' }],
      }),
    )
    process.env.FAKE_GH_COMPARE_FILE = f
    const c = new GhClient({ ghPath: FAKE })
    const cmp = await c.compareCommits({ owner: 'o', repo: 'r' }, 'oldsha', 'newsha')
    expect(cmp.status).toBe('ahead')
    expect(cmp.files).toHaveLength(1)
  })

  it('compareCommits throws GhFileNotFoundError on 404 (force-push)', async () => {
    process.env.FAKE_GH_COMPARE_NOTFOUND = '1'
    const c = new GhClient({ ghPath: FAKE })
    await expect(
      c.compareCommits({ owner: 'o', repo: 'r' }, 'oldsha', 'newsha'),
    ).rejects.toBeInstanceOf(GhFileNotFoundError)
  })
})
