import { describe, expect, it } from 'vitest'

import { sourceHash } from '../../../src/server/source/hash'
import type { SessionSource } from '../../../src/shared/source'

describe('sourceHash', () => {
  it('returns 16 hex chars', () => {
    const s: SessionSource = { kind: 'github-pr', owner: 'o', repo: 'r', number: 1 }
    expect(sourceHash(s)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic across calls', () => {
    const s: SessionSource = { kind: 'github-pr', owner: 'o', repo: 'r', number: 1 }
    expect(sourceHash(s)).toBe(sourceHash(s))
  })

  it('is stable across object key order', () => {
    const a: SessionSource = { kind: 'github-pr', owner: 'o', repo: 'r', number: 1 }
    const b: SessionSource = {
      kind: 'github-pr',
      number: 1,
      repo: 'r',
      owner: 'o',
    } as SessionSource
    expect(sourceHash(a)).toBe(sourceHash(b))
  })

  it('differs across kinds even with overlapping fields', () => {
    const pr: SessionSource = { kind: 'github-pr', owner: 'o', repo: 'r', number: 1 }
    const local: SessionSource = {
      kind: 'local-branch',
      repoPath: '/o/r',
      head: '1',
      base: 'origin/main',
    }
    expect(sourceHash(pr)).not.toBe(sourceHash(local))
  })

  it('differs when any field differs', () => {
    const a: SessionSource = { kind: 'github-pr', owner: 'o', repo: 'r', number: 1 }
    const b: SessionSource = { kind: 'github-pr', owner: 'o', repo: 'r', number: 2 }
    expect(sourceHash(a)).not.toBe(sourceHash(b))
  })
})
