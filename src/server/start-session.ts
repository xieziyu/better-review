import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Config } from './config'
import type { FindingsRepo } from './db/findings'
import type { SessionsRepo } from './db/sessions'
import type { EventBus } from './engine/events'
import type { ConcurrencyQueue } from './engine/queue'
import { runReview } from './engine/runner'
import type { GhClient } from './github/gh-client'
import { parsePRTarget } from './github/pr-target-parser'
import { renderPrompt } from './prompts/renderer'
import { resolveEffectivePrompt } from './prompts/resolver'

export interface StartSessionDeps {
  sessions: SessionsRepo
  findings: FindingsRepo
  gh: GhClient
  bus: EventBus
  queue: ConcurrencyQueue
  config: Config
  paths: { home: string; sessionsDir: string }
  cwd: string
  claudePath: string
  defaultRepo?: { owner: string; repo: string }
}

export type StartSessionFn = (prInput: string) => Promise<{ id: string }>

export function makeStartSession(deps: StartSessionDeps): StartSessionFn {
  return async function startSession(prInput) {
    const parseOpts: Parameters<typeof parsePRTarget>[1] = {}
    if (deps.defaultRepo?.owner) parseOpts.defaultOwner = deps.defaultRepo.owner
    if (deps.defaultRepo?.repo) parseOpts.defaultRepo = deps.defaultRepo.repo
    const target = parsePRTarget(prInput, parseOpts)
    const existing = deps.sessions.findActiveByPR(target.owner, target.repo, target.number)
    if (existing && existing.status !== 'failed') return { id: existing.id }

    const meta = await deps.gh.prView(target)
    const diff = await deps.gh.prDiff(target)

    const id = randomUUID()
    const workdir = join(
      deps.paths.sessionsDir,
      `pr-${target.owner}-${target.repo}-${target.number}-${id.slice(0, 8)}`,
    )
    mkdirSync(workdir, { recursive: true })
    writeFileSync(join(workdir, 'diff.cache'), diff.unifiedDiff)

    const resolved = resolveEffectivePrompt({ cwd: deps.cwd, home: deps.paths.home })
    const prompt = renderPrompt(resolved.framework, {
      rules: resolved.rules.content,
      prMeta: `#${meta.number} ${meta.title} by ${meta.author ?? '?'}\nURL: ${meta.url}\n\n${meta.body}`,
      diff: diff.unifiedDiff,
      findingsPath: join(workdir, 'findings.json'),
      schemaJson:
        'Array of finding objects with fields: id, severity, category, file, line, title, body, suggestion?',
    })

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
      workdir,
      promptUsed: prompt,
    })
    deps.bus.emit({ type: 'status-changed', sessionId: id, status: 'running' })

    void deps.queue.run(id, () =>
      runReview({
        sessionId: id,
        workdir,
        prompt,
        claudePath: deps.claudePath,
        sessions: deps.sessions,
        findings: deps.findings,
        bus: deps.bus,
        stallMs: deps.config.claudeStallMinutes * 60_000,
      }),
    )
    return { id }
  }
}
