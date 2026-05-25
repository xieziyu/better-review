import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SessionSource } from '../shared/source'
import type { AgentKind } from '../shared/types'
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
import { withGhCallRecorder, type GhClient } from './github/gh-client'
import { parsePRTarget } from './github/pr-target-parser'
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
  prInput: string
  agent?: AgentKind
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

export function makeStartSession(deps: StartSessionDeps): StartSessionFn {
  return async function startSession({
    prInput,
    agent: agentKind,
    localRepoPath: rawRepo,
    extraPrompt: rawExtra,
  }) {
    const target = parsePRTarget(prInput)
    // Construct the durable SessionSource. Phase 0 always resolves to a
    // `github-pr` source; later phases pick a different kind based on the
    // parsed input shape.
    const source: SessionSource = {
      kind: 'github-pr',
      owner: target.owner,
      repo: target.repo,
      number: target.number,
    }
    const localRepoPath =
      rawRepo !== undefined && rawRepo.trim().length > 0 ? resolveLocalRepoPath(rawRepo) : null
    const extraPrompt =
      rawExtra !== undefined && rawExtra.trim().length > 0 ? rawExtra.trim() : null
    const existing = deps.sessions.findActiveByPR(target.owner, target.repo, target.number)
    if (existing && existing.status !== 'failed' && existing.status !== 'cancelled')
      return { id: existing.id }

    const kind = agentKind ?? deps.getConfig().defaultAgent
    // Fail fast (and synchronously to the caller) if the CLI is missing —
    // there is no point inserting a pending row that will instantly fail.
    const resolvedAgent = deps.resolveAgent(kind)

    const id = randomUUID()
    const sessionShort = id.slice(0, 8)
    const workdir = join(
      deps.paths.sessionsDir,
      `pr-${target.owner}-${target.repo}-${target.number}-${sessionShort}`,
    )
    mkdirSync(workdir, { recursive: true })

    // Insert with minimal fields populated. prView hasn't run yet, so
    // title/author/url/headSha are all null. The row exists immediately
    // so the UI can navigate to its detail page and start consuming SSE
    // while the rest of prep runs in the queue worker.
    deps.sessions.insert({
      id,
      source,
      owner: target.owner,
      repo: target.repo,
      number: target.number,
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

    const flow = getSourceFlow(source, { gh: deps.gh })

    void deps.queue.run(id, async () => {
      try {
        const prepLogger = new PrepLogger({ workdir, sessionId: id, bus: deps.bus })
        const prep = await withGhCallRecorder(
          (rec) => prepLogger.recordCall(rec),
          () =>
            prepareReview({
              deps,
              id,
              workdir,
              sessionShort,
              flow,
              localRepoPath,
              extraPrompt,
              prepLogger,
            }),
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
        deps.log.warn('start-session prep failed', { id, error: msg })
        deps.sessions.setError(id, msg)
        deps.sessions.setStatus(id, 'failed')
        deps.bus.emit({ type: 'status-changed', sessionId: id, status: 'failed', error: msg })
        deps.bus.emit({ type: 'error', sessionId: id, message: msg })
        deps.bus.emit({ type: 'done', sessionId: id })
      }
    })
    return { id }
  }
}

interface PrepareReviewArgs {
  deps: StartSessionDeps
  id: string
  workdir: string
  sessionShort: string
  flow: SourceFlow
  localRepoPath: string | null
  extraPrompt: string | null
  prepLogger: PrepLogger
}

interface PrepareReviewResult {
  prompt: string
  sourcePath: string | null
}

async function prepareReview(args: PrepareReviewArgs): Promise<PrepareReviewResult> {
  const { deps, id, workdir, sessionShort, flow, localRepoPath, extraPrompt, prepLogger } = args

  prepLogger.markPhase(PREP_PHASES.fetchingPR)
  const meta = await flow.fetchMetadata()
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
  const diff = await flow.fetchDiff()
  writeFileSync(join(workdir, 'diff.cache'), diff.unifiedDiff)

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
    withCurrentPhase(sourcePhase, () =>
      flow.prepareSourceTree({
        workdir,
        sessionShort,
        headSha: meta.headSha,
        unifiedDiff: diff.unifiedDiff,
        localRepoPath,
        log: deps.log,
      }),
    ),
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
  const filtered = filterDiffByGlobs(diff.unifiedDiff, excludeGlobs)
  const diffForAgent = chooseDiffForAgent(diff.unifiedDiff, filtered)
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
