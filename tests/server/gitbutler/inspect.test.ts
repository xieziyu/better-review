import { describe, expect, it } from 'vitest'

import { type ButStatus } from '../../../src/server/gitbutler/cli'
import { foldStatusToVBranches } from '../../../src/server/gitbutler/inspect'

const MB = 'aa813a4a0b161fe60ccd54240e74e3dab8e3b4c6'
const C_A1 = '7b203371a818bb94941479a3bf28158a53d4b3b8'
const C_A2 = '3ba8985b5f98b69dc52ee32f2ec0c4fa04dbab03'
const C_C1 = '2dd468625b20d26acab73d5eba11f3b277d3e4ff'

function status(overrides: Partial<ButStatus> = {}): ButStatus {
  return {
    stacks: [],
    mergeBase: { commitId: MB },
    ...overrides,
  }
}

describe('foldStatusToVBranches', () => {
  it('emits a single bottom branch with mergeBase as its base', () => {
    const out = foldStatusToVBranches(
      status({
        stacks: [
          {
            cliId: 'k0',
            branches: [
              {
                cliId: 'g0',
                name: 'feature-a',
                commits: [
                  { commitId: C_A2, message: 'feat: a2' },
                  { commitId: C_A1, message: 'feat: a' },
                ],
              },
            ],
          },
        ],
      }),
    )
    expect(out).toEqual([
      {
        name: 'feature-a',
        tipSha: C_A2,
        baseSha: MB,
        commitCount: 2,
        stackPosition: 0,
        stackSize: 1,
      },
    ])
  })

  it('resolves a stacked top branch base to the tip of the branch below', () => {
    const out = foldStatusToVBranches(
      status({
        stacks: [
          {
            cliId: 'k0',
            branches: [
              {
                cliId: 'top',
                name: 'feature-c',
                commits: [{ commitId: C_C1, message: 'feat: stacked c' }],
              },
              {
                cliId: 'bot',
                name: 'feature-a',
                commits: [
                  { commitId: C_A2, message: 'feat: a2' },
                  { commitId: C_A1, message: 'feat: a' },
                ],
              },
            ],
          },
        ],
      }),
    )
    expect(out.map((v) => ({ name: v.name, baseSha: v.baseSha, tipSha: v.tipSha }))).toEqual([
      { name: 'feature-c', tipSha: C_C1, baseSha: C_A2 },
      { name: 'feature-a', tipSha: C_A2, baseSha: MB },
    ])
    expect(out[0]!.stackPosition).toBe(0)
    expect(out[0]!.stackSize).toBe(2)
    expect(out[1]!.stackPosition).toBe(1)
  })

  it('skips empty branches (no commits → unreviewable)', () => {
    const out = foldStatusToVBranches(
      status({
        stacks: [
          {
            cliId: 'k0',
            branches: [
              { cliId: 'top', name: 'feature-c', commits: [{ commitId: C_C1, message: 'c' }] },
              { cliId: 'mid', name: 'feature-b', commits: [] },
              {
                cliId: 'bot',
                name: 'feature-a',
                commits: [{ commitId: C_A1, message: 'a' }],
              },
            ],
          },
        ],
      }),
    )
    // feature-b dropped; feature-c's base should fall through past the
    // empty middle branch to feature-a's tip.
    expect(out.map((v) => v.name)).toEqual(['feature-c', 'feature-a'])
    expect(out[0]!.baseSha).toBe(C_A1)
    expect(out[1]!.baseSha).toBe(MB)
  })

  it('emits one entry per stack across multiple independent stacks', () => {
    const out = foldStatusToVBranches(
      status({
        stacks: [
          {
            cliId: 'k0',
            branches: [
              { cliId: 'a', name: 'feature-a', commits: [{ commitId: C_A1, message: 'a' }] },
            ],
          },
          {
            cliId: 'l0',
            branches: [
              { cliId: 'c', name: 'feature-c', commits: [{ commitId: C_C1, message: 'c' }] },
            ],
          },
        ],
      }),
    )
    expect(out.map((v) => v.name)).toEqual(['feature-a', 'feature-c'])
    expect(out.every((v) => v.baseSha === MB)).toBe(true)
  })
})
