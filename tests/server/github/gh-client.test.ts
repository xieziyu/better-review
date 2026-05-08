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
})
