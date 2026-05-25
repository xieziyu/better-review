import { describe, expect, it } from 'vitest'

import {
  parseSource,
  serializeSource,
  sessionSourceSchema,
  type SessionSource,
} from '../../src/shared/source'

describe('SessionSource schema', () => {
  it('accepts a well-formed github-pr source', () => {
    const s: SessionSource = { kind: 'github-pr', owner: 'a', repo: 'b', number: 7 }
    expect(sessionSourceSchema.parse(s)).toEqual(s)
  })

  it('rejects non-positive PR numbers', () => {
    expect(() =>
      sessionSourceSchema.parse({ kind: 'github-pr', owner: 'a', repo: 'b', number: 0 }),
    ).toThrow()
  })

  it('accepts a local-branch source', () => {
    const s: SessionSource = {
      kind: 'local-branch',
      repoPath: '/abs/path',
      head: 'feat/x',
      base: 'origin/main',
    }
    expect(sessionSourceSchema.parse(s)).toEqual(s)
  })

  it('rejects unknown kinds', () => {
    expect(() => sessionSourceSchema.parse({ kind: 'wat', repoPath: '/p' })).toThrow()
  })

  it('requires every local-branch field to be non-empty', () => {
    expect(() =>
      sessionSourceSchema.parse({
        kind: 'local-branch',
        repoPath: '',
        head: 'x',
        base: 'y',
      }),
    ).toThrow()
  })
})

describe('serializeSource / parseSource', () => {
  it('is stable across key order — github-pr', () => {
    const a: SessionSource = { kind: 'github-pr', owner: 'o', repo: 'r', number: 1 }
    const b = { number: 1, repo: 'r', owner: 'o', kind: 'github-pr' as const }
    expect(serializeSource(a)).toBe(serializeSource(b))
  })

  it('round-trips github-pr', () => {
    const s: SessionSource = { kind: 'github-pr', owner: 'o', repo: 'r', number: 42 }
    expect(parseSource(serializeSource(s))).toEqual(s)
  })

  it('round-trips local-branch', () => {
    const s: SessionSource = {
      kind: 'local-branch',
      repoPath: '/abs/p',
      head: 'HEAD',
      base: 'origin/main',
    }
    expect(parseSource(serializeSource(s))).toEqual(s)
  })

  it('round-trips gitbutler-vbranch', () => {
    const s: SessionSource = {
      kind: 'gitbutler-vbranch',
      repoPath: '/abs/p',
      vbranchName: 'feat/x',
      base: 'origin/main',
    }
    expect(parseSource(serializeSource(s))).toEqual(s)
  })

  it('rejects invalid JSON on parse', () => {
    expect(() => parseSource('not-json')).toThrow()
  })

  it('rejects valid JSON that does not match the schema', () => {
    expect(() => parseSource('{"kind":"github-pr","owner":"o"}')).toThrow()
  })
})
