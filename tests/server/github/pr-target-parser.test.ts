import { describe, it, expect } from 'vitest'

import { parsePRTarget } from '../../../src/server/github/pr-target-parser'

describe('parsePRTarget', () => {
  it('parses an HTTPS GitHub PR URL', () => {
    expect(parsePRTarget('https://github.com/foo/bar/pull/7')).toEqual({
      owner: 'foo',
      repo: 'bar',
      number: 7,
    })
  })
  it('trims surrounding whitespace before parsing', () => {
    expect(parsePRTarget('  https://github.com/foo/bar/pull/7  ')).toEqual({
      owner: 'foo',
      repo: 'bar',
      number: 7,
    })
  })
  it.each([
    ['bare number', '123'],
    ['owner/repo#N shorthand', 'foo/bar#42'],
    ['plain http URL', 'http://github.com/foo/bar/pull/7'],
    ['non-github URL', 'https://gitlab.com/foo/bar/pull/7'],
    ['gibberish', '???'],
  ])('rejects %s', (_label, input) => {
    expect(() => parsePRTarget(input)).toThrow(/GitHub PR URL/)
  })
})
