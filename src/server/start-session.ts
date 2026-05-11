import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { AgentKind } from '../shared/types'
import type { Config } from './config'
import type { FindingsRepo } from './db/findings'
import type { SessionsRepo } from './db/sessions'
import type { SubmissionCommentsRepo } from './db/submission-comments'
import type { SubmissionsRepo } from './db/submissions'
import type { ReviewAgent } from './engine/agent'
import { annotateDiffWithIncremental, extractNewHunks } from './engine/diff-incremental'
import type { EventBus } from './engine/events'
import type { ConcurrencyQueue } from './engine/queue'
import { loadPriorReviewContext, type PriorReviewContext } from './engine/rerun-context'
import { runReview } from './engine/runner'
import type { RunnerRegistry } from './engine/runner-registry'
import { prepareSourceContext } from './git/source-prep'
import type { GhClient } from './github/gh-client'
import { parsePRTarget, type PRTarget } from './github/pr-target-parser'
import type { Logger } from './logger'
import { renderPrompt, type PriorReviewVars } from './prompts/renderer'
import { resolveEffectivePrompt } from './prompts/resolver'

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
  paths: { home: string; sessionsDir: string }
  cwd: string
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

export function resolveLocalRepoPath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) throw new Error('localRepoPath must not be empty')
  const expanded =
    trimmed === '~' || trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(1)) : trimmed
  const abs = resolve(expanded)
  if (!existsSync(abs)) throw new Error(`localRepoPath does not exist: ${abs}`)
  if (!statSync(abs).isDirectory()) throw new Error(`localRepoPath is not a directory: ${abs}`)
  return abs
}

export type StartSessionFn = (input: StartSessionInput) => Promise<{ id: string }>

// Phase names emitted as SSE `progress` events during prep. The UI filters on
// these so it can show prep steps separately from agent-runtime progress.
// Kept stable and exported so the frontend can stay in sync.
export const PREP_PHASES = {
  fetchingPR: 'prep:fetching-pr',
  fetchingDiff: 'prep:fetching-diff',
  loadingPriorReview: 'prep:loading-prior-review',
  preparingSource: 'prep:preparing-source',
  renderingPrompt: 'prep:rendering-prompt',
  starting: 'prep:starting',
} as const

export function makeStartSession(deps: StartSessionDeps): StartSessionFn {
  return async function startSession({
    prInput,
    agent: agentKind,
    localRepoPath: rawRepo,
    extraPrompt: rawExtra,
  }) {
    const target = parsePRTarget(prInput)
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

    void deps.queue.run(id, async () => {
      try {
        const prep = await prepareReview({
          deps,
          id,
          workdir,
          sessionShort,
          target,
          localRepoPath,
          extraPrompt,
        })
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
        }
        if (prep.sourcePath) runArgs.sourcePath = prep.sourcePath
        deps.bus.emit({
          type: 'progress',
          sessionId: id,
          phase: PREP_PHASES.starting,
          detail: `启动 ${resolvedAgent.agent.displayName}`,
        })
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
  target: PRTarget
  localRepoPath: string | null
  extraPrompt: string | null
}

interface PrepareReviewResult {
  prompt: string
  sourcePath: string | null
}

async function prepareReview(args: PrepareReviewArgs): Promise<PrepareReviewResult> {
  const { deps, id, workdir, sessionShort, target, localRepoPath, extraPrompt } = args

  deps.bus.emit({
    type: 'progress',
    sessionId: id,
    phase: PREP_PHASES.fetchingPR,
    detail: '获取 PR 元数据',
  })
  const meta = await deps.gh.prView(target)
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

  deps.bus.emit({
    type: 'progress',
    sessionId: id,
    phase: PREP_PHASES.fetchingDiff,
    detail: '拉取 diff',
  })
  const diff = await deps.gh.prDiff(target)
  writeFileSync(join(workdir, 'diff.cache'), diff.unifiedDiff)

  // Prior review context + source prep are independent: kick them off in
  // parallel. priorContext internally fans out 3-4 gh api calls; source
  // prep typically spins up a git worktree or fetches a contents snapshot.
  deps.bus.emit({
    type: 'progress',
    sessionId: id,
    phase: PREP_PHASES.loadingPriorReview,
    detail: '检查上一轮 review 上下文',
  })
  deps.bus.emit({
    type: 'progress',
    sessionId: id,
    phase: PREP_PHASES.preparingSource,
    detail: localRepoPath ? '准备 PR head 工作树' : '快照 PR head 源码',
  })
  const [priorCtxResult, sourceResult] = await Promise.allSettled([
    loadPriorReviewContext(
      {
        sessions: deps.sessions,
        submissions: deps.submissions,
        submissionComments: deps.submissionComments,
        gh: deps.gh,
        log: deps.log,
      },
      { target, currentHeadSha: meta.headSha, prAuthor: meta.author },
    ),
    prepareSourceContext({
      localRepoPath,
      gh: deps.gh,
      target,
      headSha: meta.headSha,
      unifiedDiff: diff.unifiedDiff,
      sessionWorkdir: workdir,
      sessionShort,
      log: deps.log,
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
  const source = sourceResult.value

  deps.bus.emit({
    type: 'progress',
    sessionId: id,
    phase: PREP_PHASES.renderingPrompt,
    detail: priorCtx ? '组装 prompt（含上轮上下文）' : '组装 prompt',
  })
  const incremental =
    priorCtx && priorCtx.compare && !priorCtx.isForcePushed
      ? extractNewHunks(priorCtx.compare)
      : null
  const annotatedDiff = annotateDiffWithIncremental(
    diff.unifiedDiff,
    incremental,
    priorCtx?.lastReviewedSha ?? null,
  )

  const resolved = resolveEffectivePrompt({ cwd: deps.cwd, home: deps.paths.home })
  const promptVars: Parameters<typeof renderPrompt>[1] = {
    rules: resolved.rules.content,
    prMeta: `#${meta.number} ${meta.title} by ${meta.author ?? '?'}\nURL: ${meta.url}\n\n${meta.body}`,
    diff: annotatedDiff,
    findingsPath: join(workdir, 'findings.json'),
    schemaJson:
      'Array of finding objects with fields: id, severity, category, file, line, title, body, suggestion?',
    sourceKind: source.kind,
    sourcePath: source.sourcePath,
    headSha: source.headSha,
  }
  if (extraPrompt !== null) promptVars.extraNotes = extraPrompt
  if (priorCtx) promptVars.priorReview = toPriorReviewVars(priorCtx)
  const prompt = renderPrompt(resolved.framework, promptVars)

  deps.sessions.updatePrepArtifacts(id, {
    promptUsed: prompt,
    sourceKind: source.kind,
    sourceRefName: source.refName,
  })

  return {
    prompt,
    sourcePath: source.kind !== 'none' && source.sourcePath ? source.sourcePath : null,
  }
}
