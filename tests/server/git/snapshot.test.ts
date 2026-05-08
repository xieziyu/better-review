import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

import {
  changedPathsFromDiff,
  prepareDiffSnapshot,
  snapshotDirFor,
} from '../../../src/server/git/snapshot'
import { GhClient } from '../../../src/server/github/gh-client'

const here = dirname(fileURLToPath(import.meta.url))
const FAKE_GH = resolve(here, '../../fixtures/fake-gh.sh')

const noopLog = { info: () => {}, warn: () => {}, error: () => {} }

describe('changedPathsFromDiff', () => {
  it('extracts post-image paths and skips deletions (/dev/null)', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/gone.ts b/src/gone.ts',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/src/added.ts b/src/added.ts',
      '--- /dev/null',
      '+++ b/src/added.ts',
      '@@ -0,0 +1 @@',
      '+hi',
    ].join('\n')
    expect(changedPathsFromDiff(diff)).toEqual(['src/a.ts', 'src/added.ts'])
  })
})

describe('prepareDiffSnapshot', () => {
  it('writes each diff-touched file at the requested ref and skips 404s', async () => {
    // Stage a fixture tree the fake gh shim will read from.
    const contents = mkdtempSync(join(tmpdir(), 'br-snap-contents-'))
    mkdirSync(join(contents, 'src'), { recursive: true })
    writeFileSync(join(contents, 'src/a.ts'), 'export const a = 1\n')
    writeFileSync(join(contents, 'src/added.ts'), 'export const added = true\n')
    // Note: src/missing.ts deliberately absent → fake-gh emits HTTP 404.

    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/src/added.ts b/src/added.ts',
      '--- /dev/null',
      '+++ b/src/added.ts',
      '@@ -0,0 +1 @@',
      '+hi',
      'diff --git a/src/missing.ts b/src/missing.ts',
      '--- a/src/missing.ts',
      '+++ b/src/missing.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    const sessionWorkdir = mkdtempSync(join(tmpdir(), 'br-snap-sess-'))
    const snapshotDir = snapshotDirFor(sessionWorkdir)

    process.env.FAKE_GH_CONTENTS_DIR = contents
    try {
      const gh = new GhClient({ ghPath: FAKE_GH })
      const r = await prepareDiffSnapshot({
        gh,
        owner: 'o',
        repo: 'r',
        headSha: 'abc123',
        unifiedDiff: diff,
        snapshotDir,
        log: noopLog,
      })
      expect(r.snapshotDir).toBe(snapshotDir)
      expect(r.fetched.sort()).toEqual(['src/a.ts', 'src/added.ts'])
      expect(r.skipped).toEqual([{ path: 'src/missing.ts', reason: 'deleted' }])
      expect(readFileSync(join(snapshotDir, 'src/a.ts'), 'utf8')).toBe('export const a = 1\n')
      expect(readFileSync(join(snapshotDir, 'src/added.ts'), 'utf8')).toBe(
        'export const added = true\n',
      )
    } finally {
      delete process.env.FAKE_GH_CONTENTS_DIR
    }
  })
})
