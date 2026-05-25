// Dispatcher routing. Constructs each kind of SessionSource and asserts
// the returned flow exposes the right `kind`. Doesn't drive the flow's
// IO — kind-specific behavior lives in the per-flow tests; this test
// only protects against forgetting to register a new source kind.

import { describe, expect, it } from 'vitest'

import { getSourceFlow } from '../../../src/server/source/registry'

describe('getSourceFlow', () => {
  const fakeGh = {} as unknown as Parameters<typeof getSourceFlow>[1]['gh']

  it('routes github-pr to GithubPrFlow', () => {
    const flow = getSourceFlow(
      { kind: 'github-pr', owner: 'o', repo: 'r', number: 1 },
      { gh: fakeGh },
    )
    expect(flow.kind).toBe('github-pr')
    expect(flow.source).toEqual({ kind: 'github-pr', owner: 'o', repo: 'r', number: 1 })
  })

  it('routes local-branch to LocalBranchFlow', () => {
    const flow = getSourceFlow(
      { kind: 'local-branch', repoPath: '/tmp/x', head: 'HEAD', base: 'auto' },
      { gh: fakeGh },
    )
    expect(flow.kind).toBe('local-branch')
  })

  it('routes gitbutler-vbranch to GitButlerVBranchFlow', () => {
    const flow = getSourceFlow(
      {
        kind: 'gitbutler-vbranch',
        repoPath: '/tmp/x',
        vbranchName: 'feature-x',
        base: 'auto',
      },
      { gh: fakeGh },
    )
    expect(flow.kind).toBe('gitbutler-vbranch')
  })
})
