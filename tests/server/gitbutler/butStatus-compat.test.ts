import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ButCliError,
  butStatus,
  isUnsupportedFlagOutput,
  resetButStatusVariantCacheForTests,
} from '../../../src/server/gitbutler/cli'

const here = dirname(fileURLToPath(import.meta.url))
const FAKE_BUT = resolve(here, '../../fixtures/fake-but.sh')

// The fake ignores cwd; any existing dir works as the "repo".
const REPO = tmpdir()

describe('butStatus version compatibility', () => {
  beforeEach(() => {
    process.env.BETTER_REVIEW_BUT_BIN = FAKE_BUT
    resetButStatusVariantCacheForTests()
  })
  afterEach(() => {
    delete process.env.BETTER_REVIEW_BUT_BIN
    delete process.env.FAKE_BUT_MODE
    resetButStatusVariantCacheForTests()
  })

  it('reads status from a modern CLI (--format json)', async () => {
    process.env.FAKE_BUT_MODE = 'modern'
    const status = await butStatus(REPO)
    expect(status.mergeBase.commitId).toBe('0000000000000000000000000000000000000000')
    expect(status.stacks[0]!.branches[0]!.name).toBe('feat/example')
  })

  it('falls back to the legacy flag (--json) when --format is rejected', async () => {
    process.env.FAKE_BUT_MODE = 'legacy'
    const status = await butStatus(REPO)
    expect(status.stacks[0]!.branches[0]!.commits[0]!.commitId).toBe(
      '1111111111111111111111111111111111111111',
    )
  })

  it('propagates setup_required instead of treating it as a flag mismatch', async () => {
    process.env.FAKE_BUT_MODE = 'setup_required'
    await expect(butStatus(REPO)).rejects.toMatchObject({ code: 'setup_required' })
    await expect(butStatus(REPO)).rejects.toBeInstanceOf(ButCliError)
  })
})

describe('isUnsupportedFlagOutput', () => {
  it.each([
    ["error: unexpected argument '--json' found", true],
    ['error: unrecognized subcommand argument', true],
    ["invalid value 'json' for '--format'", true],
    ['error: setup_required', false],
    ['', false],
  ])('classifies %j as %s', (stderr, expected) => {
    expect(isUnsupportedFlagOutput(stderr as string, '')).toBe(expected)
  })
})
