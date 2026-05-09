import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { AgentKind } from '../shared/types'
import type { Config } from './config'
import type { FindingsRepo } from './db/findings'
import type { SessionsRepo } from './db/sessions'
import type { ReviewAgent } from './engine/agent'
import { annotateDiffWithLineNumbers } from './engine/diff-annotator'
import type { EventBus } from './engine/events'
import type { ConcurrencyQueue } from './engine/queue'
import { runReview } from './engine/runner'
import type { RunnerRegistry } from './engine/runner-registry'
import { prepareSourceContext } from './git/source-prep'
import type { GhClient } from './github/gh-client'
import { parsePRTarget } from './github/pr-target-parser'
import type { Logger } from './logger'
import { renderPrompt } from './prompts/renderer'
import { resolveEffectivePrompt } from './prompts/resolver'

export interface ResolvedAgent {
  agent: ReviewAgent
  executable: string
}

export interface StartSessionDeps {
  sessions: SessionsRepo
  findings: FindingsRepo
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
    const { agent, executable } = deps.resolveAgent(kind)

    const meta = await deps.gh.prView(target)
    const diff = await deps.gh.prDiff(target)

    const id = randomUUID()
    const sessionShort = id.slice(0, 8)
    const workdir = join(
      deps.paths.sessionsDir,
      `pr-${target.owner}-${target.repo}-${target.number}-${sessionShort}`,
    )
    mkdirSync(workdir, { recursive: true })
    writeFileSync(join(workdir, 'diff.cache'), diff.unifiedDiff)

    // Prepare the post-merge source the agent will read alongside the diff.
    // Worktree (pinned clone) > snapshot (gh contents) > none (diff-only).
    const source = await prepareSourceContext({
      localRepoPath,
      gh: deps.gh,
      target,
      headSha: meta.headSha,
      unifiedDiff: diff.unifiedDiff,
      sessionWorkdir: workdir,
      sessionShort,
      log: deps.log,
    })

    const resolved = resolveEffectivePrompt({ cwd: deps.cwd, home: deps.paths.home })
    const promptVars: Parameters<typeof renderPrompt>[1] = {
      rules: resolved.rules.content,
      prMeta: `#${meta.number} ${meta.title} by ${meta.author ?? '?'}\nURL: ${meta.url}\n\n${meta.body}`,
      diff: annotateDiffWithLineNumbers(diff.unifiedDiff),
      findingsPath: join(workdir, 'findings.json'),
      schemaJson:
        'Array of finding objects with fields: id, severity, category, file, line, title, body, suggestion?',
      sourceKind: source.kind,
      sourcePath: source.sourcePath,
      headSha: source.headSha,
    }
    if (extraPrompt !== null) promptVars.extraNotes = extraPrompt
    const prompt = renderPrompt(resolved.framework, promptVars)

    deps.sessions.insert({
      id,
      owner: target.owner,
      repo: target.repo,
      number: target.number,
      title: meta.title,
      author: meta.author,
      url: meta.url,
      baseRef: meta.baseRef,
      headRef: meta.headRef,
      status: 'running',
      agent: kind,
      workdir,
      localRepoPath,
      sourceKind: source.kind,
      sourceRefName: source.refName,
      promptUsed: prompt,
      extraPrompt,
    })
    deps.bus.emit({ type: 'status-changed', sessionId: id, status: 'running' })

    void deps.queue.run(id, () => {
      const runArgs: Parameters<typeof runReview>[0] = {
        sessionId: id,
        workdir,
        prompt,
        agent,
        executable,
        sessions: deps.sessions,
        findings: deps.findings,
        bus: deps.bus,
        stallMs: deps.getConfig().stallMinutes * 60_000,
        runners: deps.runners,
      }
      if (source.kind !== 'none' && source.sourcePath) {
        runArgs.sourcePath = source.sourcePath
      }
      return runReview(runArgs)
    })
    return { id }
  }
}
