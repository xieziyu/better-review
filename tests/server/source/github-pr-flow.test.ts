// Smoke test for the GithubPrFlow wrapper: it should delegate to the gh
// client with the closed-over target and rebuild the legacy `prMeta`
// string verbatim so the prompt output stays byte-identical post-refactor.

import { describe, expect, it } from 'vitest'

import type { GhClient, PRMeta } from '../../../src/server/github/gh-client'
import { makeGithubPrFlow } from '../../../src/server/source/github-pr-flow'
import type { GithubPrSource } from '../../../src/shared/source'

function fakeGh(meta: PRMeta): GhClient {
  return {
    prView: async () => meta,
    prDiff: async () => ({ unifiedDiff: 'diff --git a/x b/x\n' }),
  } as unknown as GhClient
}

const source: GithubPrSource = { kind: 'github-pr', owner: 'acme', repo: 'web', number: 42 }

describe('makeGithubPrFlow', () => {
  it('maps gh prView result to SourceMetadata', async () => {
    const meta: PRMeta = {
      number: 42,
      title: 'Add login',
      author: 'alice',
      body: 'why we added login',
      url: 'https://github.com/acme/web/pull/42',
      baseRef: 'main',
      headRef: 'feat/login',
      headSha: 'abc',
      baseSha: 'def',
    }
    const flow = makeGithubPrFlow(source, { gh: fakeGh(meta) })
    const m = await flow.fetchMetadata()
    expect(m).toEqual({
      title: 'Add login',
      author: 'alice',
      url: 'https://github.com/acme/web/pull/42',
      baseRef: 'main',
      headRef: 'feat/login',
      headSha: 'abc',
      body: 'why we added login',
    })
  })

  it('buildSourceMeta matches the legacy prMeta format', async () => {
    const meta: PRMeta = {
      number: 42,
      title: 'Add login',
      author: 'alice',
      body: 'body',
      url: 'https://github.com/acme/web/pull/42',
      baseRef: 'main',
      headRef: 'feat/login',
      headSha: '',
      baseSha: '',
    }
    const flow = makeGithubPrFlow(source, { gh: fakeGh(meta) })
    const m = await flow.fetchMetadata()
    expect(flow.buildSourceMeta(m)).toBe(
      '#42 Add login by alice\nURL: https://github.com/acme/web/pull/42\n\nbody',
    )
  })

  it('falls back to `?` for missing author', async () => {
    const meta: PRMeta = {
      number: 1,
      title: 'x',
      author: null,
      body: '',
      url: 'u',
      baseRef: 'b',
      headRef: 'h',
      headSha: '',
      baseSha: '',
    }
    const flow = makeGithubPrFlow(source, { gh: fakeGh(meta) })
    const m = await flow.fetchMetadata()
    expect(flow.buildSourceMeta(m)).toContain(' by ?\n')
  })
})
