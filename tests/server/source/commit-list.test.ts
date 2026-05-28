import { describe, expect, it } from 'vitest'

import { renderCommitList } from '../../../src/server/source/commit-list'

describe('renderCommitList', () => {
  it('returns null for undefined, empty, or single-commit inputs', () => {
    expect(renderCommitList(undefined)).toBeNull()
    expect(renderCommitList([])).toBeNull()
    expect(
      renderCommitList([
        { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', author: 'a', subject: 's', body: '' },
      ]),
    ).toBeNull()
  })

  it('renders an oldest → newest list with short shas and indented bodies', () => {
    const out = renderCommitList([
      {
        sha: '1111111111111111111111111111111111111111',
        author: 'alice',
        subject: 'first',
        body: 'body line one\nbody line two',
      },
      {
        sha: '2222222222222222222222222222222222222222',
        author: 'bob',
        subject: 'second',
        body: '',
      },
    ])
    expect(out).not.toBeNull()
    expect(out).toContain('2 commits since base (oldest → newest)')
    expect(out).toContain('[111111111111] first')
    expect(out).toContain('  body line one')
    expect(out).toContain('  body line two')
    expect(out).toContain('[222222222222] second')
  })
})
