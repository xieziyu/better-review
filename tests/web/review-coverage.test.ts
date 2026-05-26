import type { Finding } from '@shared/types'
import { describe, expect, it } from 'vitest'

import type { FileSummary } from '@/lib/diff-utils'
import { computeReviewCoverage } from '@/lib/review-coverage'

// The coverage helper only reads `path`/`oldPath`/`newPath`/`additions`/
// `deletions` off a FileSummary — hunks/fileData are irrelevant here.
function file(path: string, additions = 0, deletions = 0, oldPath = path): FileSummary {
  return {
    path,
    oldPath,
    newPath: path,
    status: 'modify',
    additions,
    deletions,
    hunks: [],
    fileData: {} as FileSummary['fileData'],
  }
}

let findingSeq = 0
function finding(over: Partial<Finding> & Pick<Finding, 'severity'>): Finding {
  findingSeq += 1
  return {
    id: `R${findingSeq}`,
    dbId: `d${findingSeq}`,
    sessionId: 's1',
    ord: findingSeq,
    category: 'C',
    file: null,
    line: null,
    title: 't',
    body: 'b',
    selected: true,
    edited: false,
    archived: false,
    createdAt: 0,
    source: 'agent',
    ...over,
  }
}

describe('computeReviewCoverage', () => {
  it('computes stats across files and findings', () => {
    const cov = computeReviewCoverage(
      [file('a.ts', 10, 2), file('b.ts', 5, 1)],
      [
        finding({ severity: 'must', file: 'a.ts', line: 1 }),
        finding({ severity: 'should', file: 'b.ts', line: 2 }),
        finding({ severity: 'nit' }),
      ],
      [{ path: 'pnpm-lock.yaml', glob: 'pnpm-lock.yaml' }],
      null,
    )
    expect(cov.stats).toEqual({
      fileCount: 2,
      additions: 15,
      deletions: 3,
      findingCounts: { must: 1, should: 1, nit: 1, total: 3 },
      excludedCount: 1,
    })
  })

  it('assigns a status to each file in priority order', () => {
    const cov = computeReviewCoverage(
      [file('lock.yaml'), file('must.ts'), file('found.ts'), file('clean.ts')],
      [
        finding({ severity: 'must', file: 'must.ts', line: 1 }),
        finding({ severity: 'nit', file: 'found.ts', line: 1 }),
      ],
      [{ path: 'lock.yaml', glob: '*.yaml' }],
      null,
    )
    const byPath = Object.fromEntries(cov.rows.map((r) => [r.path, r.status]))
    expect(byPath['lock.yaml']).toBe('excluded')
    expect(byPath['must.ts']).toBe('flagged')
    expect(byPath['found.ts']).toBe('found')
    expect(byPath['clean.ts']).toBe('clean')
    // Rows are sorted flagged → found → clean → excluded.
    expect(cov.rows.map((r) => r.status)).toEqual(['flagged', 'found', 'clean', 'excluded'])
    expect(cov.rows[3]!.excludedGlob).toBe('*.yaml')
  })

  it('flags a file the agent named even without a must finding', () => {
    const cov = computeReviewCoverage([file('auth.ts')], [], [], {
      overview: 'o',
      manualReview: [{ file: 'auth.ts', reason: 'security-sensitive' }],
    })
    expect(cov.rows[0]!.status).toBe('flagged')
  })

  it('builds the attention list from agent notes plus uncalled must files', () => {
    const cov = computeReviewCoverage(
      [file('auth.ts'), file('parser.ts')],
      [
        finding({ severity: 'must', file: 'auth.ts', line: 1 }),
        finding({ severity: 'must', file: 'parser.ts', line: 1 }),
      ],
      [],
      {
        overview: 'o',
        manualReview: [
          { file: 'auth.ts', reason: 'check token edge cases' },
          { file: null, reason: 'watch the write race' },
        ],
      },
    )
    // auth.ts (agent note, also has must) + the PR-wide note + parser.ts
    // (must finding the agent did not separately call out).
    expect(cov.attention).toHaveLength(3)
    const auth = cov.attention.find((a) => a.file === 'auth.ts')!
    expect(auth.source).toBe('agent')
    expect(auth.reason).toBe('check token edge cases')
    expect(auth.hasMust).toBe(true)
    const prWide = cov.attention.find((a) => a.file === null)!
    expect(prWide.source).toBe('agent')
    const parser = cov.attention.find((a) => a.file === 'parser.ts')!
    expect(parser.source).toBe('derived')
    expect(parser.reason).toBeNull()
    expect(parser.hasMust).toBe(true)
  })

  it('marks findings-free files as pending while the agent is still running', () => {
    const cov = computeReviewCoverage(
      [file('a.ts'), file('b.ts')],
      [finding({ severity: 'must', file: 'a.ts', line: 1 })],
      [],
      null,
      true,
    )
    const byPath = Object.fromEntries(cov.rows.map((r) => [r.path, r.status]))
    // a.ts has a must finding — flagged regardless of in-progress flag.
    expect(byPath['a.ts']).toBe('flagged')
    // b.ts has no findings yet — must not be reported as "clean" while running.
    expect(byPath['b.ts']).toBe('pending')
  })

  it('canonicalises a renamed file so old-path findings line up', () => {
    const renamed: FileSummary = { ...file('src/new.ts'), oldPath: 'src/old.ts', status: 'rename' }
    const cov = computeReviewCoverage(
      [renamed],
      [finding({ severity: 'must', file: 'src/old.ts', line: 1 })],
      [],
      null,
    )
    expect(cov.rows[0]!.path).toBe('src/new.ts')
    expect(cov.rows[0]!.findingCount).toBe(1)
    expect(cov.rows[0]!.status).toBe('flagged')
  })
})
