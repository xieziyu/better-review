// Thin wrappers around the git CLI for the local-branch source flow.
// Kept apart from the GitHub PR path so the call shapes stay obvious —
// these all run inside the user's pinned repo, with `git -C <repoPath>`,
// and never reach for `gh`.

import { execa } from 'execa'

import type { Logger } from '../logger'

export interface LocalBranchInspect {
  // Sha the symbolic head resolved to. Always populated on success.
  headSha: string
  // Best-effort short ref name for the head (branch shortname, tag, or
  // 'HEAD' when detached). Used for display in the session row.
  headRef: string | null
  // Latest commit metadata for the prompt's {{SOURCE_META}} string and
  // the human-readable session row.
  author: string | null
  subject: string
  body: string
}

export class LocalGitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalGitError'
  }
}

async function git(
  repoPath: string,
  args: string[],
): Promise<{ stdout: string; exitCode: number }> {
  const r = await execa('git', ['-C', repoPath, ...args], { reject: false })
  return {
    stdout: String(r.stdout ?? ''),
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : 1,
  }
}

// Confirm `repoPath` is inside a git working tree. Cheap and idempotent —
// runs once per session at the very start of the local-branch flow so we
// surface a friendly error instead of letting downstream commands fail
// piecemeal.
export async function assertGitRepo(repoPath: string): Promise<void> {
  const r = await git(repoPath, ['rev-parse', '--git-dir'])
  if (r.exitCode !== 0) {
    throw new LocalGitError(`not a git repository: ${repoPath}`)
  }
}

// Resolve a head spec ('HEAD', branch name, tag, or sha) into a concrete
// 40-char sha. Throws on unknown revisions.
export async function resolveSha(repoPath: string, rev: string): Promise<string> {
  const r = await git(repoPath, ['rev-parse', '--verify', `${rev}^{commit}`])
  if (r.exitCode !== 0) throw new LocalGitError(`unknown revision: ${rev}`)
  return r.stdout.trim()
}

// Resolve to a human-readable ref name where possible — branch shortname
// for branch heads, tag for tags, otherwise null (detached / sha input).
export async function resolveRefName(repoPath: string, rev: string): Promise<string | null> {
  // `rev-parse --abbrev-ref` returns 'HEAD' for detached heads — treat
  // that as "no nice name" so the UI doesn't show a useless "HEAD" pill.
  const r = await git(repoPath, ['rev-parse', '--abbrev-ref', rev])
  if (r.exitCode !== 0) return null
  const name = r.stdout.trim()
  if (!name || name === 'HEAD') return null
  return name
}

// Pull the latest commit's author/subject/body for `sha`. The `%x00`
// separator is a NUL byte so the body (which may contain newlines) does
// not collide with our split.
export async function readCommitMeta(
  repoPath: string,
  sha: string,
): Promise<{ author: string | null; subject: string; body: string }> {
  const r = await git(repoPath, ['log', '-1', '--format=%an%x00%s%x00%b', sha])
  if (r.exitCode !== 0) throw new LocalGitError(`git log failed for ${sha}`)
  const [author, subject, body] = r.stdout.replace(/\n$/, '').split('\x00')
  return {
    author: author && author.length > 0 ? author : null,
    subject: subject ?? '',
    body: (body ?? '').trim(),
  }
}

// Resolve the configured default remote head (e.g. `refs/remotes/origin/main`).
// Returns null when the symbolic ref is missing — common right after a
// `git clone --no-single-branch` or in tests with no remote set up.
export async function detectDefaultRemoteHead(repoPath: string): Promise<string | null> {
  const r = await git(repoPath, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
  if (r.exitCode !== 0) return null
  const v = r.stdout.trim()
  return v.length > 0 ? v : null
}

// Pick the default diff base for the chosen head. Order of preference:
//   1. `refs/remotes/origin/HEAD` (whatever the remote considers default)
//   2. `origin/main` if it resolves
//   3. `origin/master` if it resolves
// Returns null when none resolve — caller should error or prompt the
// user to pick a base explicitly.
export async function autoBase(repoPath: string): Promise<string | null> {
  const symbolic = await detectDefaultRemoteHead(repoPath)
  if (symbolic) return symbolic
  for (const candidate of ['origin/main', 'origin/master']) {
    const r = await git(repoPath, ['rev-parse', '--verify', candidate])
    if (r.exitCode === 0) return candidate
  }
  return null
}

// Resolve `base` if the source still carries the 'auto' sentinel.
// Pulled out so LocalBranchFlow stays declarative.
export async function resolveBase(repoPath: string, base: string): Promise<string> {
  if (base !== 'auto') return base
  const detected = await autoBase(repoPath)
  if (!detected) {
    throw new LocalGitError(
      `could not auto-detect a diff base in ${repoPath} — set the remote default branch (\`git remote set-head origin -a\`) or pass an explicit base`,
    )
  }
  return detected
}

// Three-dot diff so the agent only sees changes that head introduced
// beyond the common ancestor with base, matching standard PR semantics.
export async function readDiff(repoPath: string, base: string, head: string): Promise<string> {
  // `--no-color --no-ext-diff` keeps the output as raw unified diff text
  // regardless of the user's git config (some users set `[diff] external`
  // or `[color] ui = always`, which would otherwise corrupt the diff).
  const r = await git(repoPath, [
    '--no-pager',
    'diff',
    '--no-color',
    '--no-ext-diff',
    `${base}...${head}`,
  ])
  if (r.exitCode !== 0) {
    throw new LocalGitError(`git diff ${base}...${head} failed in ${repoPath}`)
  }
  return r.stdout
}

export interface LocalBranchEntry {
  name: string
  sha: string
  committedAt: number
}

// List local branches in `repoPath`, newest commit first, with the
// current HEAD shortname (or null when detached). Pure read-only —
// powers the Home tab pickers.
export async function listLocalBranches(
  repoPath: string,
): Promise<{ head: string | null; branches: LocalBranchEntry[] }> {
  // Tab-separated format keeps the parser dead simple. `objectname:short`
  // gives 7-char shas (git's default), `committerdate:unix` is the
  // epoch-seconds timestamp we need for relative-time display.
  const r = await git(repoPath, [
    'for-each-ref',
    '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:unix)',
    '--sort=-committerdate',
    'refs/heads',
  ])
  if (r.exitCode !== 0) throw new LocalGitError(`git for-each-ref failed in ${repoPath}`)
  const branches: LocalBranchEntry[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line) continue
    const [name, sha, ts] = line.split('\t')
    if (!name || !sha || !ts) continue
    const committedAt = Number(ts)
    if (!Number.isFinite(committedAt)) continue
    branches.push({ name, sha, committedAt })
  }
  // `git rev-parse --abbrev-ref HEAD` returns 'HEAD' literal for detached
  // states. Treat that as null so the UI doesn't badge a non-existent branch.
  const headR = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const headName = headR.exitCode === 0 ? headR.stdout.trim() : ''
  const head = headName && headName !== 'HEAD' ? headName : null
  return { head, branches }
}

// Inspect a local branch end-to-end: resolve head→sha, ref name, commit
// metadata. Used by the flow's fetchMetadata().
export async function inspectLocalBranch(
  repoPath: string,
  head: string,
  log: Logger,
): Promise<LocalBranchInspect> {
  await assertGitRepo(repoPath)
  const headSha = await resolveSha(repoPath, head)
  const headRef = await resolveRefName(repoPath, head)
  const meta = await readCommitMeta(repoPath, headSha)
  log.info('local branch inspected', {
    repoPath,
    head,
    sha: headSha.slice(0, 12),
    ref: headRef,
  })
  return { headSha, headRef, author: meta.author, subject: meta.subject, body: meta.body }
}
