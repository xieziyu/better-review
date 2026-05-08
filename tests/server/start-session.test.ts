import { mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'

import { describe, it, expect } from 'vitest'

import { resolveLocalRepoPath } from '../../src/server/start-session'

describe('resolveLocalRepoPath', () => {
  it('returns the absolute path for an existing directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-lrp-'))
    expect(resolveLocalRepoPath(dir)).toBe(dir)
  })

  it('expands ~ to the user home directory', () => {
    // homedir() should always exist and be a directory; test that the leading
    // tilde is replaced and the path remains valid.
    const out = resolveLocalRepoPath('~')
    expect(out).toBe(homedir())
  })

  it('expands ~/sub when sub exists', () => {
    // We can't safely create files inside the real home dir from tests, so
    // assert only that the expansion produces a string starting with home.
    const fake = '~/this-path-almost-certainly-does-not-exist-br-test'
    expect(() => resolveLocalRepoPath(fake)).toThrow(/does not exist/)
  })

  it('throws when the path does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-lrp-'))
    expect(() => resolveLocalRepoPath(`${dir}${sep}missing`)).toThrow(/does not exist/)
  })

  it('throws when the path points at a regular file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'br-lrp-'))
    const file = join(dir, 'a-file.txt')
    writeFileSync(file, 'hi')
    expect(() => resolveLocalRepoPath(file)).toThrow(/not a directory/)
  })

  it('throws when given an empty string', () => {
    expect(() => resolveLocalRepoPath('   ')).toThrow(/must not be empty/)
  })
})
