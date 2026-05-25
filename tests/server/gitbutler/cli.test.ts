import { describe, expect, it } from 'vitest'

import { ButCliError, parseButStatus } from '../../../src/server/gitbutler/cli'

// Captured from `but status --json` during the Phase 2 spike (see
// docs/plans/local-source-review.md). Stripped down to the fields the
// parser actually reads.
const TWO_STACK_FIXTURE = {
  unassignedChanges: [{ cliId: 'yt', filePath: 'b.js', changeType: 'added' }],
  stacks: [
    {
      cliId: 'k0',
      assignedChanges: [],
      branches: [
        {
          cliId: 'g0',
          name: 'feature-c',
          commits: [
            {
              cliId: '2d',
              commitId: '2dd468625b20d26acab73d5eba11f3b277d3e4ff',
              createdAt: '2026-05-25T06:16:48+00:00',
              message: 'feat: stacked c',
              authorName: 'xieziyu',
              authorEmail: 'rainnyxzy@gmail.com',
              conflicted: false,
              reviewId: null,
              changes: null,
            },
          ],
          upstreamCommits: [],
          branchStatus: 'completelyUnpushed',
        },
        {
          cliId: 'h0',
          name: 'feature-a',
          commits: [
            {
              cliId: '3b',
              commitId: '3ba8985b5f98b69dc52ee32f2ec0c4fa04dbab03',
              message: 'feat: a2',
              authorName: 'xieziyu',
            },
            {
              cliId: '7b',
              commitId: '7b203371a818bb94941479a3bf28158a53d4b3b8',
              message: 'feat: a',
              authorName: 'xieziyu',
            },
          ],
        },
      ],
    },
    {
      cliId: 'l0',
      assignedChanges: [],
      branches: [
        {
          cliId: 'i0',
          name: 'feature-b',
          commits: [],
        },
      ],
    },
  ],
  mergeBase: {
    cliId: '',
    commitId: 'aa813a4a0b161fe60ccd54240e74e3dab8e3b4c6',
    message: 'Initial empty commit\n',
  },
}

describe('parseButStatus', () => {
  it('extracts stacks, branches, and commits from the spike fixture', () => {
    const status = parseButStatus(TWO_STACK_FIXTURE)
    expect(status.mergeBase.commitId).toBe('aa813a4a0b161fe60ccd54240e74e3dab8e3b4c6')
    expect(status.stacks).toHaveLength(2)

    const stackedStack = status.stacks[0]!
    expect(stackedStack.branches.map((b) => b.name)).toEqual(['feature-c', 'feature-a'])
    expect(stackedStack.branches[0]!.commits.map((c) => c.commitId)).toEqual([
      '2dd468625b20d26acab73d5eba11f3b277d3e4ff',
    ])
    expect(stackedStack.branches[1]!.commits.map((c) => c.commitId)).toEqual([
      '3ba8985b5f98b69dc52ee32f2ec0c4fa04dbab03',
      '7b203371a818bb94941479a3bf28158a53d4b3b8',
    ])

    const emptyStack = status.stacks[1]!
    expect(emptyStack.branches[0]!.name).toBe('feature-b')
    expect(emptyStack.branches[0]!.commits).toEqual([])
  })

  it('passes optional commit fields through when present', () => {
    const status = parseButStatus(TWO_STACK_FIXTURE)
    const topCommit = status.stacks[0]!.branches[0]!.commits[0]!
    expect(topCommit.message).toBe('feat: stacked c')
    expect(topCommit.createdAt).toBe('2026-05-25T06:16:48+00:00')
    expect(topCommit.authorName).toBe('xieziyu')
  })

  it.each([
    ['null input', null, 'expected JSON object'],
    ['no mergeBase', { stacks: [] }, 'missing mergeBase'],
    ['mergeBase without commitId', { stacks: [], mergeBase: {} }, 'missing mergeBase.commitId'],
    [
      'stacks as a string',
      { stacks: 'oops', mergeBase: { commitId: 'a' } },
      'stacks is not an array',
    ],
    [
      'branch without name',
      {
        stacks: [{ cliId: 'a', branches: [{ cliId: 'b', commits: [] }] }],
        mergeBase: { commitId: 'x' },
      },
      'branches[0].name is empty',
    ],
    [
      'commit without commitId',
      {
        stacks: [
          {
            cliId: 'a',
            branches: [{ cliId: 'b', name: 'feat', commits: [{ cliId: 'x' }] }],
          },
        ],
        mergeBase: { commitId: 'x' },
      },
      'commits[0].commitId is empty',
    ],
  ])('throws ButCliError on %s', (_label, input, fragment) => {
    expect(() => parseButStatus(input)).toThrow(ButCliError)
    expect(() => parseButStatus(input)).toThrow(fragment as string)
  })
})
