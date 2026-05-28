import { describe, it, expect } from 'vitest'

import { dedupAgainstPrior, type PriorPostedComment } from '../../../src/server/engine/submit-dedup'
import type { ReviewComment } from '../../../src/server/github/gh-client'

function priorPosted(over: Partial<PriorPostedComment> = {}): PriorPostedComment {
  return {
    findingDbId: 'prior-1',
    githubCommentId: 999,
    path: 'foo.ts',
    line: 11,
    startLine: null,
    body: '🔴 **[must]** the long enough title we are matching\n\nbody',
    ...over,
  }
}

function rc(over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    path: 'foo.ts',
    line: 11,
    side: 'RIGHT',
    body: '🔴 **[must]** the long enough title we are matching\n\nbody',
    ...over,
  }
}

describe('dedupAgainstPrior', () => {
  it('returns all proposed comments when there is no prior list', () => {
    const r = dedupAgainstPrior([rc()], [])
    expect(r.toSubmit).toHaveLength(1)
    expect(r.skipped).toHaveLength(0)
  })

  it('skips exact path+line+title duplicates', () => {
    const r = dedupAgainstPrior([rc()], [priorPosted()])
    expect(r.toSubmit).toHaveLength(0)
    expect(r.skipped).toHaveLength(1)
  })

  it('skips when line ranges overlap and titles share a substring', () => {
    const proposed = rc({ line: 13, start_line: 11, start_side: 'RIGHT' })
    const prior = priorPosted({ line: 12, startLine: 11 })
    const r = dedupAgainstPrior([proposed], [prior])
    expect(r.toSubmit).toHaveLength(0)
    expect(r.skipped[0]!.priorMatch.line).toBe(12)
  })

  it('keeps comments with same file+line but different titles', () => {
    const proposed = rc({ body: '🟡 **[should]** completely different thing\n\nbody' })
    const r = dedupAgainstPrior([proposed], [priorPosted()])
    expect(r.toSubmit).toHaveLength(1)
  })

  it('keeps comments on a different file', () => {
    const proposed = rc({ path: 'other.ts' })
    const r = dedupAgainstPrior([proposed], [priorPosted()])
    expect(r.toSubmit).toHaveLength(1)
  })

  it('skips even when severity emoji differs (normalization strips it)', () => {
    const proposed = rc({
      body: '🟡 **[should]** the long enough title we are matching\n\nbody',
    })
    const r = dedupAgainstPrior([proposed], [priorPosted()])
    expect(r.toSubmit).toHaveLength(0)
  })

  it('does not match when normalized title is too short to be safely substring-matched', () => {
    const proposed = rc({ body: '🔴 **[must]** fix\n\nbody' })
    const prior = priorPosted({ body: '🔴 **[must]** fix it now\n\nbody' })
    const r = dedupAgainstPrior([proposed], [prior])
    // Both normalize to short strings; substring would match accidentally
    // for tiny titles, so we require a minimum overlap length.
    expect(r.toSubmit).toHaveLength(1)
  })

  it('skips file-level proposed matching a prior file-level on same file + title', () => {
    const proposed: ReviewComment = {
      path: 'foo.ts',
      subject_type: 'file',
      body: '🔴 **[must]** the long enough title we are matching\n\nbody',
    }
    const prior = priorPosted({ line: null, startLine: null })
    const r = dedupAgainstPrior([proposed], [prior])
    expect(r.toSubmit).toHaveLength(0)
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]!.reason).toMatch(/file-level/)
  })

  it('does not cross-match file-level with line-anchored comments', () => {
    const proposed: ReviewComment = {
      path: 'foo.ts',
      subject_type: 'file',
      body: '🔴 **[must]** the long enough title we are matching\n\nbody',
    }
    // Prior comment was line-anchored — different scope, keep the proposed one.
    const r = dedupAgainstPrior([proposed], [priorPosted()])
    expect(r.toSubmit).toHaveLength(1)
  })
})
