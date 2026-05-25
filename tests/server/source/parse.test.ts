import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseSessionInput } from '../../../src/server/source/parse'

describe('parseSessionInput', () => {
  it('parses a canonical GitHub PR URL', () => {
    const s = parseSessionInput('https://github.com/acme/web/pull/42')
    expect(s).toEqual({ kind: 'github-pr', owner: 'acme', repo: 'web', number: 42 })
  })

  it('strips leading/trailing whitespace', () => {
    const s = parseSessionInput('  https://github.com/acme/web/pull/1  ')
    expect(s).toEqual({ kind: 'github-pr', owner: 'acme', repo: 'web', number: 1 })
  })

  it('rejects an empty input', () => {
    expect(() => parseSessionInput('   ')).toThrow(/empty/)
  })

  it('rejects a bare repo name with no leading slash or tilde', () => {
    expect(() => parseSessionInput('my-repo')).toThrow(/PR URL/)
  })

  it('parses an absolute path as a local-branch source with defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-parse-'))
    const s = parseSessionInput(dir)
    expect(s).toEqual({
      kind: 'local-branch',
      repoPath: dir,
      head: 'HEAD',
      base: 'auto',
    })
  })

  it('honors localBranchHead and localBranchBase overrides', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-parse-'))
    const s = parseSessionInput(dir, {
      localBranchHead: 'feat/x',
      localBranchBase: 'origin/main',
    })
    expect(s).toEqual({
      kind: 'local-branch',
      repoPath: dir,
      head: 'feat/x',
      base: 'origin/main',
    })
  })

  it('treats whitespace-only override hints as defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-parse-'))
    const s = parseSessionInput(dir, {
      localBranchHead: '   ',
      localBranchBase: '',
    })
    expect(s).toEqual({
      kind: 'local-branch',
      repoPath: dir,
      head: 'HEAD',
      base: 'auto',
    })
  })

  it('rejects URLs that are not GitHub PRs', () => {
    expect(() => parseSessionInput('https://example.com/foo')).toThrow()
  })

  it('routes to gitbutler-vbranch when vbranchName is supplied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-parse-'))
    const s = parseSessionInput(dir, { vbranchName: 'feature-x' })
    expect(s).toEqual({
      kind: 'gitbutler-vbranch',
      repoPath: dir,
      vbranchName: 'feature-x',
      base: 'auto',
    })
  })

  it('ignores a whitespace-only vbranchName and falls back to local-branch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-parse-'))
    const s = parseSessionInput(dir, { vbranchName: '   ' })
    expect(s.kind).toBe('local-branch')
  })
})
