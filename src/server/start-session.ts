import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SessionSource } from '../shared/source'
import type { AgentKind, PRSession } from '../shared/types'
import type { Config } from './config'
import type { FindingsRepo } from './db/findings'
import type { SessionsRepo } from './db/sessions'
import type { SubmissionCommentsRepo } from './db/submission-comments'
import type { SubmissionsRepo } from './db/submissions'
import type { ReviewAgent } from './engine/agent'
import { chooseDiffForAgent, filterDiffByGlobs, resolveExcludeGlobs } from './engine/diff-filter'
import { annotateDiffWithIncremental, extractNewHunks } from './engine/diff-incremental'
import type { EventBus } from './engine/events'
import { PrepLogger, withCurrentPhase } from './engine/prep-logger'
import type { ConcurrencyQueue } from './engine/queue'
import type { PriorReviewContext } from './engine/rerun-context'
import { runReview } from './engine/runner'
import type { RunnerRegistry } from './engine/runner-registry'
import { snapshotDirFor } from './git/snapshot'
import type { SourceContext } from './git/source-prep'
import { cleanupWorktree, worktreeDirFor } from './git/worktree'
import { withGhCallRecorder, type GhClient } from './github/gh-client'
import type { Logger } from './logger'
import { resolveLocalRepoPath } from './paths'
import { renderPrompt, type PriorReviewVars } from './prompts/renderer'
import { resolveEffectivePrompt } from './prompts/resolver'
import { getSourceFlow } from './source/registry'
import type { SourceFlow } from './source/types'

export interface ResolvedAgent {
  agent: ReviewAgent
  executable: string
}

export interface StartSessionDeps {
  sessions: SessionsRepo
  findings: FindingsRepo
  submissions: SubmissionsRepo
  submissionComments: SubmissionCommentsRepo
  gh: GhClient
  bus: EventBus
  queue: ConcurrencyQueue
  runners: RunnerRegistry
  // Read on each call so config edits hot-apply to the next session. Note that
  // `maxConcurrentReviews` is consumed at queue construction time, so changing
  // it still requires a daemon restart.
  getConfig: () => Config
  paths: { home: string; sessionsDir: string; codexHome: string }
  log: Logger
  // Resolves a kind to a concrete agent + located executable. Throws when the
  // CLI is not installed so the daemon can surface the error to the caller.
  resolveAgent: (kind: AgentKind) => ResolvedAgent
}

function toPriorReviewVars(ctx: PriorReviewContext): PriorReviewVars {
  return {
    lastReviewedSha: ctx.lastReviewedSha ?? '',
    forcePushed: ctx.isForcePushed,
    reviewBody: ctx.reviewBody,
    inlineComments: ctx.inlineComments.map((c) => ({
      file: c.file,
      line: c.line,
      startLine: c.startLine,
      body: c.body,
      replies: c.replies,
    })),
    issueComments: ctx.issueComments,
  }
}

export interface StartSessionInput {
  // Pre-resolved SessionSource. The API layer calls parseSessionInput()
  // to turn the raw user string into this; rerun-session reuses the
  // archived session's source verbatim.
  source: SessionSource
  agent?: AgentKind
  // For GitHub-PR sources this pins the local clone the worktree-source
  // strategy uses. For local-branch and gitbutler-vbranch sources the
  // caller can omit it — `source.repoPath` already names the repo, and
  // startSession derives `session.localRepoPath` from it. Passing it
  // explicitly still works (the UI does, and rerun-session preserves
  // the prior value); the derivation only kicks in when it's absent.
  localRepoPath?: string
  extraPrompt?: string
}

export type StartSessionFn = (input: StartSessionInput) => Promise<{ id: string }>

// Phase names emitted as SSE `progress` events during prep. The UI filters on
// the `prep:` prefix so it can show prep steps separately from agent-runtime
// progress. Phases are stable identifiers that the web app translates per
// language; the optional `detail` is interpolation data, never user-facing
// prose. The agent-spawn transition is emitted separately by runner.ts under
// the `agent:` prefix once the session flips to status 'running'.
export const PREP_PHASES = {
  fetchingPR: 'prep:fetching-pr',
  fetchingDiff: 'prep:fetching-diff',
  loadingPriorReview: 'prep:loading-prior-review',
  preparingSourceWorktree: 'prep:preparing-source:worktree',
  preparingSourceSnapshot: 'prep:preparing-source:snapshot',
  renderingPrompt: 'prep:rendering-prompt',
  renderingPromptWithPrior: 'prep:rendering-prompt:with-prior',
} as const

// Compact display identifiers per source kind, used to name the session
// workdir. Kept short + filesystem-safe (no slashes) so the path stays
// inside sessionsDir and is easy to spot in `ls`.
function workdirSlug(source: SessionSource): string {
  switch (source.kind) {
    case 'github-pr':
      return `pr-${source.owner}-${source.repo}-${source.number}`
    case 'local-branch': {
      // Last path segment of the repo, sanitized to [\w.-]. The
      // session-id suffix below disambiguates if two sessions hit the
      // same basename.
      const base = source.repoPath.replace(/\/+$/, '').split('/').pop() ?? 'repo'
      const safe = base.replace(/[^\w.-]+/g, '_') || 'repo'
      return `local-${safe}`
    }
    case 'gitbutler-vbranch': {
      const base = source.repoPath.replace(/\/+$/, '').split('/').pop() ?? 'repo'
      const safe = base.replace(/[^\w.-]+/g, '_') || 'repo'
      return `vbranch-${safe}`
    }
  }
}

// Vestigial PR-shaped columns the session row still has (owner / repo /
// number, all NOT NULL). For non-PR sources we fill them with safe
// placeholders so existing reads keep working. A future migration can
// make these nullable and drop the placeholders.
function placeholderPrFields(source: SessionSource): {
  owner: string
  repo: string
  number: number
} {
  if (source.kind === 'github-pr') {
    return { owner: source.owner, repo: source.repo, number: source.number }
  }
  return { owner: '', repo: '', number: 0 }
}

export function makeStartSession(deps: StartSessionDeps): StartSessionFn {
  return async function startSession({
    source,
    agent: agentKind,
    localRepoPath: rawRepo,
    extraPrompt: rawExtra,
  }) {
    // Resolution order: for local-branch and vbranch sources the persisted
    // `localRepoPath` MUST equal `source.repoPath` — the worktree is
    // created at `source.repoPath` (see local-branch-flow.ts), so a
    // divergent override would leave delete-session's cleanupWorktree
    // pointing at the wrong repo and orphan the real `.git/worktrees/<name>/`
    // entry. The UI and rerun-session pass an explicit value that already
    // matches; reject anything else. For GitHub-PR sources the explicit
    // override is the only signal (the source has no repoPath), so we
    // honor it as-is and fall back to null. Without the local-source
    // fallback an API caller that only supplies a path-shaped `prInput`
    // would create a worktree but leave `session.localRepoPath` null,
    // silently disabling project-tier prompt resolution and worktree
    // cleanup.
    const explicitLocalRepoPath =
      rawRepo !== undefined && rawRepo.trim().length > 0 ? resolveLocalRepoPath(rawRepo) : null
    const sourceRepoPath =
      source.kind === 'local-branch' || source.kind === 'gitbutler-vbranch' ? source.repoPath : null
    if (
      sourceRepoPath !== null &&
      explicitLocalRepoPath !== null &&
      explicitLocalRepoPath !== sourceRepoPath
    ) {
      throw new Error(
        `localRepoPath must match source.repoPath for ${source.kind} sessions (got ${explicitLocalRepoPath} vs ${sourceRepoPath})`,
      )
    }
    const localRepoPath = sourceRepoPath ?? explicitLocalRepoPath
    const extraPrompt =
      rawExtra !== undefined && rawExtra.trim().length > 0 ? rawExtra.trim() : null

    // PR dedup: avoid two concurrent reviews of the same PR. Local-branch
    // and vbranch get a follow-up source_hash-based dedup later — for
    // Phase 1b we always allow concurrent local sessions.
    if (source.kind === 'github-pr') {
      const existing = deps.sessions.findActiveByPR(source.owner, source.repo, source.number)
      if (existing && existing.status !== 'failed' && existing.status !== 'cancelled')
        return { id: existing.id }
    }

    const kind = agentKind ?? deps.getConfig().defaultAgent
    // Fail fast (and synchronously to the caller) if the CLI is missing —
    // there is no point inserting a pending row that will instantly fail.
    const resolvedAgent = deps.resolveAgent(kind)

    const id = randomUUID()
    const sessionShort = id.slice(0, 8)
    const workdir = join(deps.paths.sessionsDir, `${workdirSlug(source)}-${sessionShort}`)
    mkdirSync(workdir, { recursive: true })

    const prFields = placeholderPrFields(source)
    // Insert with minimal fields populated. prView hasn't run yet, so
    // title/author/url/headSha are all null. The row exists immediately
    // so the UI can navigate to its detail page and start consuming SSE
    // while the rest of prep runs in the queue worker.
    deps.sessions.insert({
      id,
      source,
      owner: prFields.owner,
      repo: prFields.repo,
      number: prFields.number,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'pending',
      agent: kind,
      workdir,
      localRepoPath,
      sourceKind: null,
      sourceRefName: null,
      promptUsed: '',
      extraPrompt,
      headSha: null,
    })
    deps.bus.emit({ type: 'status-changed', sessionId: id, status: 'pending' })

    void deps.queue.run(id, () => {
      const session = deps.sessions.getById(id)
      // The row was inserted synchronously above, so getById always hits;
      // the guard only narrows the type.
      if (!session) return Promise.resolve()
      return runSessionPipeline({ deps, session, resolvedAgent, resume: false })
    })
    return { id }
  }
}

export interface RunSessionPipelineArgs {
  deps: StartSessionDeps
  session: PRSession
  resolvedAgent: ResolvedAgent
  // false for a fresh session, true when re-entering a previously `failed`
  // session (retry). On resume, prepareReview reuses any prep artifact that
  // already succeeded (diff.cache, the materialized source tree) and pins the
  // head SHA to the persisted value so the retry stays frozen at the same PR
  // state the original run reviewed.
  resume: boolean
}

// The body of one review run: prep → agent. Shared by startSession (fresh) and
// retrySession (resume). Owns the terminal failure handling so any throw from
// prep or the runner flips the session to `failed` with the error persisted.
export async function runSessionPipeline(args: RunSessionPipelineArgs): Promise<void> {
  const { deps, session, resolvedAgent, resume } = args
  const id = session.id
  const workdir = session.workdir
  const sessionShort = id.slice(0, 8)
  const flow = getSourceFlow(session.source, { gh: deps.gh })
  try {
    const prepLogger = new PrepLogger({ workdir, sessionId: id, bus: deps.bus })
    const prep = await withGhCallRecorder(
      (rec) => prepLogger.recordCall(rec),
      () => prepareReview({ deps, session, workdir, sessionShort, flow, prepLogger, resume }),
    )
    const runArgs: Parameters<typeof runReview>[0] = {
      sessionId: id,
      workdir,
      prompt: prep.prompt,
      agent: resolvedAgent.agent,
      executable: resolvedAgent.executable,
      sessions: deps.sessions,
      findings: deps.findings,
      bus: deps.bus,
      stallMs: deps.getConfig().stallMinutes * 60_000,
      runners: deps.runners,
      codexHome: deps.paths.codexHome,
    }
    if (prep.sourcePath) runArgs.sourcePath = prep.sourcePath
    await runReview(runArgs)
  } catch (e) {
    const msg = (e as Error).message
    deps.log.warn('session pipeline failed', { id, error: msg })
    deps.sessions.setError(id, msg)
    deps.sessions.setStatus(id, 'failed')
    deps.bus.emit({ type: 'status-changed', sessionId: id, status: 'failed', error: msg })
    deps.bus.emit({ type: 'error', sessionId: id, message: msg })
    deps.bus.emit({ type: 'done', sessionId: id })
  }
}

interface PrepareReviewArgs {
  deps: StartSessionDeps
  session: PRSession
  workdir: string
  sessionShort: string
  flow: SourceFlow
  prepLogger: PrepLogger
  resume: boolean
}

interface PrepareReviewResult {
  prompt: string
  sourcePath: string | null
}

// Read a file, returning its content only when non-blank. Used to decide
// whether a prior attempt's diff.cache is reusable on resume.
function readNonEmptyFile(path: string): string | null {
  try {
    const s = readFileSync(path, 'utf8')
    return s.trim().length > 0 ? s : null
  } catch {
    return null
  }
}

// On resume, reconstruct the SourceContext for a tree the prior attempt left on
// disk. Returns null when there is nothing trustworthy to reuse (sourceKind not
// yet persisted — prep never completed — or the materialized dir is gone), in
// which case the caller rebuilds. Exported for unit testing.
export function reuseSourceContext(session: PRSession, workdir: string): SourceContext | null {
  switch (session.sourceKind) {
    case 'none':
      return {
        kind: 'none',
        sourcePath: '',
        headSha: session.headSha ?? '',
        refName: null,
        partial: false,
      }
    case 'worktree': {
      const dir = worktreeDirFor(workdir)
      if (!existsSync(dir)) return null
      return {
        kind: 'worktree',
        sourcePath: dir,
        headSha: session.headSha ?? '',
        refName: session.sourceRefName,
        partial: false,
      }
    }
    case 'snapshot': {
      const dir = snapshotDirFor(workdir)
      if (!existsSync(dir)) return null
      return {
        kind: 'snapshot',
        sourcePath: dir,
        headSha: session.headSha ?? '',
        refName: null,
        partial: true,
      }
    }
    default:
      return null
  }
}

// Remove partial source artifacts from a failed attempt before rebuilding on
// resume. A half-created worktree leaves a dir that `git worktree add` would
// refuse; drop both the registry entry (best-effort) and the physical dir.
async function cleanupPartialSource(
  session: PRSession,
  workdir: string,
  log: StartSessionDeps['log'],
): Promise<void> {
  const wt = worktreeDirFor(workdir)
  if (existsSync(wt)) {
    if (session.localRepoPath) {
      await cleanupWorktree({
        localRepoPath: session.localRepoPath,
        worktreeDir: wt,
        refName: session.sourceRefName,
        log,
      })
    }
    if (existsSync(wt)) rmSync(wt, { recursive: true, force: true })
  }
  const snap = snapshotDirFor(workdir)
  if (existsSync(snap)) rmSync(snap, { recursive: true, force: true })
}

async function prepareReview(args: PrepareReviewArgs): Promise<PrepareReviewResult> {
  const { deps, session, workdir, sessionShort, flow, prepLogger, resume } = args
  const id = session.id
  const localRepoPath = session.localRepoPath
  const extraPrompt = session.extraPrompt

  // On resume, a non-empty diff.cache means fetching-diff already succeeded on
  // the prior attempt. Reuse it verbatim so the retry stays frozen at the same
  // PR state the original run reviewed (the user chose retry, not rerun). The
  // cached diff anchors the freeze — the head SHA and source tree below pin to
  // match it.
  const diffCachePath = join(workdir, 'diff.cache')
  const cachedDiff = resume ? readNonEmptyFile(diffCachePath) : null
  const frozen = cachedDiff !== null

  prepLogger.markPhase(PREP_PHASES.fetchingPR)
  const fetchedMeta = await flow.fetchMetadata()
  // Pin the head SHA to the persisted value when honoring a frozen diff, so the
  // source tree + prompt key off the exact SHA the diff was taken at even if the
  // PR advanced between the failed run and this retry.
  const meta =
    frozen && session.headSha ? { ...fetchedMeta, headSha: session.headSha } : fetchedMeta
  // Backfill the row so the UI shows title/author as soon as we know them
  // (it's polling the session via React Query + SSE invalidation).
  deps.sessions.updatePRMeta(id, {
    title: meta.title,
    author: meta.author,
    url: meta.url,
    baseRef: meta.baseRef,
    headRef: meta.headRef,
    headSha: meta.headSha,
  })

  prepLogger.markPhase(PREP_PHASES.fetchingDiff)
  let unifiedDiff: string
  if (cachedDiff !== null) {
    unifiedDiff = cachedDiff
  } else {
    const diff = await flow.fetchDiff()
    writeFileSync(diffCachePath, diff.unifiedDiff)
    unifiedDiff = diff.unifiedDiff
  }

  // Prior review context + source prep are independent: kick them off in
  // parallel. priorContext internally fans out 3-4 gh api calls; source
  // prep typically spins up a git worktree or fetches a contents snapshot.
  // Each branch wraps its body in `withCurrentPhase` so the AsyncLocalStorage-
  // scoped phase tag stays correct even though both branches run concurrently
  // and `prepLogger.currentPhase` would otherwise race.
  const sourcePhase = localRepoPath
    ? PREP_PHASES.preparingSourceWorktree
    : PREP_PHASES.preparingSourceSnapshot
  prepLogger.markPhase(PREP_PHASES.loadingPriorReview)
  prepLogger.markPhase(sourcePhase)
  // On resume, reuse a source tree the prior attempt already materialized
  // (its dir is still on disk). prepareReview only persists sourceKind once it
  // runs to completion, so a non-null sourceKind here means prep finished last
  // time and the artifact is trustworthy — skip the (often network-bound)
  // rebuild. Otherwise clean any partial remains before rebuilding.
  const reusedSource = resume ? reuseSourceContext(session, workdir) : null
  const [priorCtxResult, sourceResult] = await Promise.allSettled([
    withCurrentPhase(PREP_PHASES.loadingPriorReview, () =>
      flow.loadPriorContext({
        sessions: deps.sessions,
        submissions: deps.submissions,
        submissionComments: deps.submissionComments,
        log: deps.log,
        currentHeadSha: meta.headSha,
        authorLogin: meta.author,
      }),
    ),
    reusedSource
      ? Promise.resolve(reusedSource)
      : withCurrentPhase(sourcePhase, async () => {
          if (resume) await cleanupPartialSource(session, workdir, deps.log)
          return flow.prepareSourceTree({
            workdir,
            sessionShort,
            headSha: meta.headSha,
            unifiedDiff,
            localRepoPath,
            log: deps.log,
          })
        }),
  ])
  const priorCtx: PriorReviewContext | null =
    priorCtxResult.status === 'fulfilled' ? priorCtxResult.value : null
  if (priorCtxResult.status === 'rejected') {
    deps.log.warn('prior-review context unavailable', {
      error: (priorCtxResult.reason as Error).message,
    })
  }
  if (sourceResult.status === 'rejected') {
    // prepareSourceContext is supposed to handle its own failures and
    // return kind:'none'. Treat an unexpected throw as fatal.
    throw sourceResult.reason
  }
  const sourceCtx = sourceResult.value

  prepLogger.markPhase(
    priorCtx ? PREP_PHASES.renderingPromptWithPrior : PREP_PHASES.renderingPrompt,
  )
  const incremental =
    priorCtx && priorCtx.compare && !priorCtx.isForcePushed
      ? extractNewHunks(priorCtx.compare)
      : null

  // Drop non-reviewable files (lockfiles, generated artifacts) from the diff
  // fed to the agent so we don't burn prompt tokens on them. `diff.cache`
  // above keeps the raw full diff for the web UI + submit-time validation.
  const excludeGlobs = resolveExcludeGlobs(deps.getConfig().reviewExcludeGlobs)
  const filtered = filterDiffByGlobs(unifiedDiff, excludeGlobs)
  const diffForAgent = chooseDiffForAgent(unifiedDiff, filtered)
  // Persist the exclusions so the Summary tab can show what the agent never
  // saw, even on a daemon restart. When chooseDiffForAgent fell back to the
  // raw diff (every file matched a glob), the agent *did* see those files —
  // persist an empty list so the Summary tab doesn't mislabel them as
  // "Not reviewed".
  deps.sessions.setExcludedFiles(
    id,
    diffForAgent === filtered.filteredDiff ? filtered.excludedFiles : [],
  )
  if (filtered.excludedFiles.length > 0) {
    const phase = priorCtx ? PREP_PHASES.renderingPromptWithPrior : PREP_PHASES.renderingPrompt
    const files = filtered.excludedFiles.map((f) => f.path).join(', ')
    // chooseDiffForAgent falls back to the raw diff when every file matched a
    // glob — in that case nothing was actually removed from the prompt, so the
    // log must not claim otherwise.
    prepLogger.markPhase(
      phase,
      diffForAgent === filtered.filteredDiff
        ? `excluded ${filtered.excludedFiles.length} non-reviewable file(s) from the review prompt: ${files}`
        : `all changed files matched review-exclude globs; using the raw diff so the review prompt is not empty: ${files}`,
    )
  }

  const annotatedDiff = annotateDiffWithIncremental(
    diffForAgent,
    incremental,
    priorCtx?.lastReviewedSha ?? null,
  )

  const resolved = resolveEffectivePrompt({
    projectDir: localRepoPath,
    home: deps.paths.home,
    lang: deps.getConfig().language,
  })
  const promptVars: Parameters<typeof renderPrompt>[1] = {
    rules: resolved.rules.content,
    prMeta: flow.buildSourceMeta(meta),
    diff: annotatedDiff,
    findingsPath: join(workdir, 'findings.json'),
    schemaJson:
      'Array of finding objects with fields: id, severity, category, file, line, title, body, suggestion?',
    summaryPath: join(workdir, 'summary.json'),
    summarySchema:
      'A single JSON object with fields: overview (string, a short markdown description of the main changes), manualReview (array of objects with fields: file (string repo-relative path, or null for a PR-wide note) and reason (string))',
    sourceKind: sourceCtx.kind,
    sourcePath: sourceCtx.sourcePath,
    headSha: sourceCtx.headSha,
    sessionKind: flow.source.kind,
  }
  if (extraPrompt !== null) promptVars.extraNotes = extraPrompt
  if (priorCtx) promptVars.priorReview = toPriorReviewVars(priorCtx)
  const prompt = renderPrompt(resolved.framework, promptVars)

  deps.sessions.updatePrepArtifacts(id, {
    promptUsed: prompt,
    sourceKind: sourceCtx.kind,
    sourceRefName: sourceCtx.refName,
  })

  return {
    prompt,
    sourcePath: sourceCtx.kind !== 'none' && sourceCtx.sourcePath ? sourceCtx.sourcePath : null,
  }
}
