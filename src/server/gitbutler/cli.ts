// Thin wrapper around the GitButler CLI (`but`). Kept tiny and dependency-
// free so the rest of the server can call into it without knowing about
// execa or how `but` is invoked. Scoped to the read-only commands we need
// for source inspection — Phase 2 never mutates GitButler state.

import { execa } from 'execa'

export class ButCliError extends Error {
  constructor(
    public readonly code:
      | 'missing'
      | 'setup_required'
      | 'not_a_repo'
      // The CLI rejected an argument we passed (clap "unexpected argument"
      // usage error). Used to drive flag-spelling fallback across `but`
      // versions — see `butStatus`.
      | 'unsupported_flag'
      | 'unknown',
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
  // Explicit override (tests point this at a fake; users can pin a
  // specific binary). Never cached so it can vary between calls.
  const override = process.env['BETTER_REVIEW_BUT_BIN']
  if (typeof override === 'string' && override.trim().length > 0) {
    return override.trim()
  }
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
    const errCode =
      parsed && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : undefined
    const rawMessage =
      parsed && typeof parsed === 'object' ? (parsed as { message?: unknown }).message : undefined
    const message = typeof rawMessage === 'string' ? rawMessage : undefined
    if (errCode === 'setup_required') {
      throw new ButCliError('setup_required', message ?? 'no GitButler project at this path')
    }
    if (errCode === 'not_a_repo') {
      throw new ButCliError('not_a_repo', message ?? 'not a git repository')
    }
    // Argument-parse failures (clap) come back with no JSON body and a
    // "unexpected argument" usage error on stderr — this is how an
    // older/newer `but` rejects a flag spelling it doesn't know. Flag it
    // so callers can retry with an alternate spelling.
    if (parsed === undefined && isUnsupportedFlagOutput(String(r.stderr ?? ''), stdout)) {
      throw new ButCliError(
        'unsupported_flag',
        `but ${args.join(' ')}: ${String(r.stderr ?? stdout)
          .trim()
          .slice(0, 200)}`,
      )
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

// Recognize a clap argument-parse failure across `but` versions. clap
// phrases these as "unexpected argument '--foo' found" /
// "unrecognized ... argument" / "invalid value ... for '--format'".
export function isUnsupportedFlagOutput(stderr: string, stdout: string): boolean {
  const text = `${stderr}\n${stdout}`
  return /unexpected argument|unrecognized .*argument|invalid value .*for/i.test(text)
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

// The `but status` JSON flag spelling changed across CLI versions:
// GitButler CLI >= 0.20 uses `--format json`, older releases used
// `--json`. We try the spellings in order and remember the one that
// works, so a single machine probes at most once. Passing the wrong
// spelling exits 2 with an argument error, which — left unhandled —
// would silently downgrade a GitButler project to plain git.
const STATUS_VARIANTS: readonly (readonly string[])[] = [
  ['status', '--format', 'json'],
  ['status', '--json'],
]
let cachedVariantIndex: number | undefined

// Convenience: run `but status` (JSON) and parse it in one call,
// transparently falling back across flag spellings for older/newer CLIs.
export async function butStatus(repoPath: string): Promise<ButStatus> {
  const indices = STATUS_VARIANTS.map((_, i) => i)
  const order =
    cachedVariantIndex === undefined
      ? indices
      : [cachedVariantIndex, ...indices.filter((i) => i !== cachedVariantIndex)]

  let lastErr: unknown
  for (let k = 0; k < order.length; k++) {
    const idx = order[k]!
    const args = [...STATUS_VARIANTS[idx]!]
    try {
      const raw = await butJson(repoPath, args)
      cachedVariantIndex = idx
      return parseButStatus(raw)
    } catch (e) {
      lastErr = e
      // Only a flag the CLI doesn't understand justifies trying the next
      // spelling. Anything else (setup_required, not_a_repo, missing, a
      // real parse error) is meaningful and must propagate untouched.
      if (e instanceof ButCliError && e.code === 'unsupported_flag' && k < order.length - 1) {
        continue
      }
      throw e
    }
  }
  // Unreachable in practice (the loop returns or throws), but keeps the
  // type checker satisfied and surfaces the last error if it ever is.
  throw lastErr
}

// Test-only: reset the cached flag spelling so independent cases don't
// leak the winning variant across the single-fork vitest process.
export function resetButStatusVariantCacheForTests(): void {
  cachedVariantIndex = undefined
}
