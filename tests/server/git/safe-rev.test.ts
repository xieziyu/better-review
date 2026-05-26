import { describe, it, expect } from 'vitest'

import {
  readCommitMeta,
  readDiff,
  resolveBase,
  resolveRefName,
  resolveSha,
} from '../../../src/server/git/local-branch'

// Rev inputs feed into `git rev-parse`/`git diff`/`git log` via execa, which
// blocks shell injection but does NOT stop git from parsing a leading `-` as
// a CLI option. The helpers reject obvious option-shaped revs synchronously
// (before any git invocation) so an untrusted API caller cannot smuggle in
// `--output=...`-style flags. We use a non-existent repoPath because the
// rejection should happen before git ever runs.
describe('local-branch rev validation rejects option-shaped input', () => {
  const repo = '/tmp/never-used-because-validation-throws-first'

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['leading dash', '--output=/etc/passwd'],
    ['single dash flag', '-fancy'],
  ])('resolveSha rejects %s', async (_name, bad) => {
    await expect(resolveSha(repo, bad)).rejects.toThrow()
  })

  it('resolveRefName rejects option-shaped input', async () => {
    await expect(resolveRefName(repo, '--upload-pack=evil')).rejects.toThrow(/must not start/)
  })

  it('readCommitMeta rejects option-shaped sha', async () => {
    await expect(readCommitMeta(repo, '-fakesha')).rejects.toThrow(/must not start/)
  })

  it('readDiff rejects option-shaped base', async () => {
    await expect(readDiff(repo, '--output=evil', 'HEAD')).rejects.toThrow(/base.*must not start/)
  })

  it('readDiff rejects option-shaped head', async () => {
    await expect(readDiff(repo, 'main', '-evil')).rejects.toThrow(/head.*must not start/)
  })

  it('resolveBase passes through a safe explicit base without invoking git', async () => {
    // 'origin/main' is option-safe; the helper returns it directly without
    // running git, so a non-existent repoPath is fine.
    await expect(resolveBase(repo, 'origin/main')).resolves.toBe('origin/main')
  })

  it('resolveBase rejects option-shaped explicit base', async () => {
    await expect(resolveBase(repo, '--evil')).rejects.toThrow(/must not start/)
  })
})
