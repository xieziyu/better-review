// Thin wrapper around the GitButler CLI (`but`). Kept tiny and dependency-
// free so the rest of the server can call into it without knowing about
// execa or how `but` is invoked. Scoped to the read-only commands we need
// for source inspection — Phase 2 never mutates GitButler state.

import { execa } from 'execa'

export class ButCliError extends Error {
  constructor(
    public readonly code: 'missing' | 'setup_required' | 'not_a_repo' | 'unknown',
    message: string,
  ) {
    super(message)
    this.name = 'ButCliError'
  }
}

// Cached at boot so the inspect route doesn't shell out to `which` per
// request. Null means "not installed at startup"; callers should surface
// a clear "Install GitButler CLI" hint rather than trying to invoke it.
let cachedButPath: string | null | undefined

export async function findButExecutable(): Promise<string | null> {
  if (cachedButPath !== undefined) return cachedButPath
  try {
    const r = await execa('which', ['but'], { reject: false })
    const path = String(r.stdout ?? '').trim()
    cachedButPath = r.exitCode === 0 && path.length > 0 ? path : null
  } catch {
    cachedButPath = null
  }
  return cachedButPath
}

// Run `but <args>` inside `repoPath` and return the parsed JSON body.
// `but` writes structured errors to stdout with `{"error": "<code>"}` —
// we surface them as typed ButCliError so callers can distinguish "this
// is not a GitButler project" from "the CLI itself blew up".
export async function butJson<T = unknown>(repoPath: string, args: string[]): Promise<T> {
  const exe = await findButExecutable()
  if (!exe) {
    throw new ButCliError('missing', 'GitButler CLI (`but`) is not installed')
  }
  const r = await execa(exe, args, { cwd: repoPath, reject: false })
  const stdout = String(r.stdout ?? '')
  if (r.exitCode !== 0) {
    // `but` prints structured errors to stdout even on non-zero exit.
    // Try to parse for a recognizable code; fall back to a generic
    // 'unknown' wrap so callers always get a typed throw.
    const parsed = safeParse(stdout)
    const errCode = parsed && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : undefined
    const message =
      parsed && typeof parsed === 'object'
        ? ((parsed as { message?: unknown }).message as string | undefined)
        : undefined
    if (errCode === 'setup_required') {
      throw new ButCliError('setup_required', message ?? 'no GitButler project at this path')
    }
    if (errCode === 'not_a_repo') {
      throw new ButCliError('not_a_repo', message ?? 'not a git repository')
    }
    throw new ButCliError(
      'unknown',
      `but ${args.join(' ')} exited ${r.exitCode}: ${(message ?? String(r.stderr ?? stdout)).slice(0, 300)}`,
    )
  }
  const parsed = safeParse(stdout)
  if (parsed === undefined) {
    throw new ButCliError('unknown', `but ${args.join(' ')} returned non-JSON output`)
  }
  return parsed as T
}

function safeParse(input: string): unknown | undefined {
  try {
    return JSON.parse(input)
  } catch {
    return undefined
  }
}

// The subset of `but status --json` that we depend on. The CLI carries
// more fields (assignedChanges, upstreamCommits, CI status, …) — we
// pick out only what's needed to compute per-vbranch tip/base. Anything
// missing or extra is tolerated.
export interface ButStatusCommit {
  commitId: string
  message: string
  createdAt?: string
  authorName?: string
}

export interface ButStatusBranch {
  cliId: string
  name: string
  commits: ButStatusCommit[]
}

export interface ButStatusStack {
  cliId: string
  branches: ButStatusBranch[]
}

export interface ButStatus {
  stacks: ButStatusStack[]
  mergeBase: {
    commitId: string
  }
}

// Parse the relevant slice of `but status --json`. Throws ButCliError
// when the shape is unexpected (e.g. a major version bump renames keys).
export function parseButStatus(raw: unknown): ButStatus {
  if (!raw || typeof raw !== 'object') {
    throw new ButCliError('unknown', 'but status: expected JSON object')
  }
  const r = raw as Record<string, unknown>
  const mergeBase = r['mergeBase']
  if (!mergeBase || typeof mergeBase !== 'object') {
    throw new ButCliError('unknown', 'but status: missing mergeBase')
  }
  const mergeBaseCommit = (mergeBase as Record<string, unknown>)['commitId']
  if (typeof mergeBaseCommit !== 'string' || mergeBaseCommit.length === 0) {
    throw new ButCliError('unknown', 'but status: missing mergeBase.commitId')
  }
  const stacksRaw = r['stacks']
  if (!Array.isArray(stacksRaw)) {
    throw new ButCliError('unknown', 'but status: stacks is not an array')
  }
  const stacks: ButStatusStack[] = stacksRaw.map((s, i) => {
    if (!s || typeof s !== 'object') {
      throw new ButCliError('unknown', `but status: stacks[${i}] is not an object`)
    }
    const sr = s as Record<string, unknown>
    const branchesRaw = sr['branches']
    if (!Array.isArray(branchesRaw)) {
      throw new ButCliError('unknown', `but status: stacks[${i}].branches is not an array`)
    }
    return {
      cliId: typeof sr['cliId'] === 'string' ? (sr['cliId'] as string) : '',
      branches: branchesRaw.map((b, j) => parseBranch(b, i, j)),
    }
  })
  return { stacks, mergeBase: { commitId: mergeBaseCommit } }
}

function parseBranch(raw: unknown, stackIdx: number, branchIdx: number): ButStatusBranch {
  if (!raw || typeof raw !== 'object') {
    throw new ButCliError(
      'unknown',
      `but status: stacks[${stackIdx}].branches[${branchIdx}] is not an object`,
    )
  }
  const b = raw as Record<string, unknown>
  const name = b['name']
  if (typeof name !== 'string' || name.length === 0) {
    throw new ButCliError(
      'unknown',
      `but status: stacks[${stackIdx}].branches[${branchIdx}].name is empty`,
    )
  }
  const commitsRaw = b['commits']
  if (!Array.isArray(commitsRaw)) {
    throw new ButCliError(
      'unknown',
      `but status: stacks[${stackIdx}].branches[${branchIdx}].commits is not an array`,
    )
  }
  return {
    cliId: typeof b['cliId'] === 'string' ? (b['cliId'] as string) : '',
    name,
    commits: commitsRaw.map((c, k) => parseCommit(c, stackIdx, branchIdx, k)),
  }
}

function parseCommit(
  raw: unknown,
  stackIdx: number,
  branchIdx: number,
  commitIdx: number,
): ButStatusCommit {
  if (!raw || typeof raw !== 'object') {
    throw new ButCliError(
      'unknown',
      `but status: stacks[${stackIdx}].branches[${branchIdx}].commits[${commitIdx}] is not an object`,
    )
  }
  const c = raw as Record<string, unknown>
  const commitId = c['commitId']
  if (typeof commitId !== 'string' || commitId.length === 0) {
    throw new ButCliError(
      'unknown',
      `but status: stacks[${stackIdx}].branches[${branchIdx}].commits[${commitIdx}].commitId is empty`,
    )
  }
  return {
    commitId,
    message: typeof c['message'] === 'string' ? (c['message'] as string) : '',
    ...(typeof c['createdAt'] === 'string' ? { createdAt: c['createdAt'] as string } : {}),
    ...(typeof c['authorName'] === 'string' ? { authorName: c['authorName'] as string } : {}),
  }
}

// Convenience: run `but status --json` and parse it in one call.
export async function butStatus(repoPath: string): Promise<ButStatus> {
  const raw = await butJson(repoPath, ['status', '--json'])
  return parseButStatus(raw)
}
