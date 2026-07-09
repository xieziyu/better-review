import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { serve } from '@hono/node-server'
import { execa } from 'execa'

import type { AgentKind, HealthStatus, ReviewEvent } from '../shared/types'
import { AGENT_KINDS } from '../shared/types'
import { createApp, type AppDeps } from './api/app'
import { makeCancelSession } from './cancel-session'
import type { Config } from './config'
import { loadConfigWithWarnings, pickEffectiveDefaultAgent } from './config'
import { openDatabase } from './db/connection'
import { FindingsRepo } from './db/findings'
import { SessionsRepo } from './db/sessions'
import { SubmissionCommentsRepo } from './db/submission-comments'
import { SubmissionsRepo } from './db/submissions'
import { makeDeleteSession } from './delete-session'
import { getAgent, whichBinary } from './engine/agent'
import type { ReviewAgent } from './engine/agent'
import { EventBus } from './engine/events'
import { ConcurrencyQueue } from './engine/queue'
import { RunnerRegistry } from './engine/runner-registry'
import { submitSession } from './engine/submit'
import { detectFolderPicker } from './fs/folder-picker'
import { makeGCSessions } from './gc'
import { worktreeDirFor } from './git/worktree'
import { GhClient } from './github/gh-client'
import { createLogger } from './logger'
import { resolvePaths } from './paths'
import { PromptStore } from './prompts/store'
import { makeRerunSession } from './rerun-session'
import { makeRetrySession } from './retry-session'
import { makeStartSession, type ResolvedAgent, type StartSessionDeps } from './start-session'
import { getAppVersion } from './version'

export interface ServerHandle {
  port: number
  pid: number
  shutdown: () => Promise<void>
}

export interface StartDaemonOpts {
  home?: string
}

export async function startDaemon(opts: StartDaemonOpts = {}): Promise<ServerHandle> {
  const paths = resolvePaths(opts.home)
  mkdirSync(paths.home, { recursive: true })
  mkdirSync(paths.sessionsDir, { recursive: true })

  const log = createLogger(paths.daemonLog)
  log.info('startup begin', { pid: process.pid, home: paths.home, version: getAppVersion() })
  const {
    config: initialConfig,
    warnings,
    defaultAgentExplicit,
  } = loadConfigWithWarnings(paths.home)
  for (const w of warnings) log.warn(w)
  // Mutable so PUT /api/config can hot-reload most keys (defaultAgent,
  // stallMinutes, perPRGCDays). `port` and `maxConcurrentReviews` are bound
  // at boot time and require a daemon restart.
  let configState: Config = initialConfig
  const getConfig = (): Config => configState
  const setConfig = (next: Config): void => {
    configState = next
  }
  log.info('config loaded', {
    port: configState.port,
    maxConcurrentReviews: configState.maxConcurrentReviews,
    defaultAgent: configState.defaultAgent,
    stallMinutes: configState.stallMinutes,
  })
  const db = openDatabase(paths.dbFile)
  log.info('db opened', { file: paths.dbFile })
  const sessions = new SessionsRepo(db)
  const findings = new FindingsRepo(db)
  const submissions = new SubmissionsRepo(db)
  const submissionComments = new SubmissionCommentsRepo(db)
  const bus = new EventBus()
  const queue = new ConcurrencyQueue(configState.maxConcurrentReviews)
  const runners = new RunnerRegistry()
  const gh = new GhClient()
  const promptStore = new PromptStore({ home: paths.home })
  const folderPicker = detectFolderPicker()
  log.info('folder picker', { kind: folderPicker.kind })

  // Cache findExecutable() once at startup; restart the daemon to pick up
  // newly installed agents.
  const agentPaths = Object.fromEntries(
    AGENT_KINDS.map((k) => [k, getAgent(k).findExecutable()]),
  ) as Record<AgentKind, string | null>

  // If the user never wrote `defaultAgent` to config.json, the value is just
  // the schema default ('codex') — fall back to the first installed agent so a
  // claude-only or pi-only machine works out of the box. Memory-only on
  // purpose: next boot recomputes, so installing a higher-priority agent later
  // takes effect automatically.
  if (!defaultAgentExplicit) {
    const effective = pickEffectiveDefaultAgent(configState.defaultAgent, agentPaths)
    if (effective !== configState.defaultAgent) {
      log.info('defaultAgent auto-switched', {
        from: configState.defaultAgent,
        to: effective,
        reason: 'configured CLI not found and defaultAgent not explicit in config.json',
      })
      configState = { ...configState, defaultAgent: effective }
    }
  }

  const resolveAgent = (kind: AgentKind): ResolvedAgent => {
    const agent: ReviewAgent = getAgent(kind)
    const executable = agentPaths[kind]
    if (!executable) {
      throw new Error(
        `${agent.displayName} CLI not found in PATH; install it or pick a different agent`,
      )
    }
    return { agent, executable }
  }

  const startSessionDeps: StartSessionDeps = {
    sessions,
    findings,
    submissions,
    submissionComments,
    gh,
    bus,
    queue,
    runners,
    getConfig,
    paths: { home: paths.home, sessionsDir: paths.sessionsDir, codexHome: paths.codexHome },
    log,
    resolveAgent,
  }
  const startSession = makeStartSession(startSessionDeps)
  const rerun = makeRerunSession({ sessions, findings, startSession })
  const retry = makeRetrySession(startSessionDeps)
  const deleteSession = makeDeleteSession({
    db,
    sessions,
    submissions,
    queue,
    runners,
    sessionsDir: paths.sessionsDir,
    log,
  })
  const cancelSession = makeCancelSession({ sessions, queue, runners, bus })

  const gcSessions = makeGCSessions({
    sessions,
    deleteSession,
    getPerPRGCDays: () => configState.perPRGCDays,
    log,
  })
  void gcSessions()
    .then(({ deleted, skipped }) => {
      log.info('gc complete', { deleted: deleted.length, skipped })
    })
    .catch((e) => log.warn('gc errored', { error: (e as Error).message }))

  // Worktree orphan sweep: previous daemon runs may have rm'd a session
  // workdir without removing the parent clone's `.git/worktrees/<name>/`
  // registry entry (e.g. crash, manual rm -rf). `git worktree prune` is
  // idempotent and only drops entries whose workdir is missing — safe to
  // run unconditionally per unique pinned clone we ever wrote a worktree to.
  void (async () => {
    const seen = new Set<string>()
    for (const s of sessions.list()) {
      if (s.sourceKind !== 'worktree' || !s.localRepoPath) continue
      if (seen.has(s.localRepoPath)) continue
      seen.add(s.localRepoPath)
      // Confirm the dir is missing before pruning — if the session is still
      // mid-review (worktree dir exists), prune is still a no-op for it,
      // but bailing here keeps the log noise down.
      if (existsSync(worktreeDirFor(s.workdir))) continue
      try {
        await execa('git', ['-C', s.localRepoPath, 'worktree', 'prune'], { reject: false })
      } catch (e) {
        log.warn('orphan worktree prune errored', {
          localRepoPath: s.localRepoPath,
          error: (e as Error).message,
        })
      }
    }
  })()

  let port = 0
  const startedAt = Date.now()
  const here = dirname(fileURLToPath(import.meta.url))
  const webDir = join(here, '..', 'web')
  const deps: AppDeps = {
    sessions,
    findings,
    submissions,
    submissionComments,
    bus,
    gh,
    promptStore,
    promptHome: paths.home,
    folderPicker,
    getConfig,
    setConfig,
    configFile: paths.configFile,
    webDir,
    getPort: () => port,
    startSession,
    rerunSession: async (id, rerunOpts) => {
      const fresh = await rerun(id, rerunOpts)
      log.info('rerun started', { id, freshId: fresh.id, agent: rerunOpts?.agent })
      return fresh
    },
    retrySession: async (id) => {
      const result = await retry(id)
      log.info('retry started', { id })
      return result
    },
    deleteSession: async (id) => {
      await deleteSession(id)
      log.info('session deleted', { id })
    },
    cancelSession: async (id) => {
      await cancelSession(id)
      log.info('session cancelled', { id })
    },
    submitSession: (id, event: ReviewEvent, body) => {
      const submitArgs: Parameters<typeof submitSession>[0] = {
        sessionId: id,
        event,
        language: configState.language,
        sessions,
        findings,
        submissions,
        submissionComments,
        gh,
      }
      if (body !== undefined) submitArgs.body = body
      return submitSession(submitArgs)
    },
    health: async () => {
      const ghWhich = whichBinary('gh')
      const status: HealthStatus = {
        ok: true,
        agents: Object.fromEntries(
          AGENT_KINDS.map((k) => [k, { found: !!agentPaths[k] }]),
        ) as HealthStatus['agents'],
        defaultAgent: configState.defaultAgent,
        gh: {
          found: !!ghWhich,
          authed: await gh.authStatus().catch(() => false),
        },
        fs: { folderPicker: { supported: folderPicker.supported } },
        daemon: {
          pid: process.pid,
          port,
          startedAt,
          home: paths.home,
          logPath: paths.daemonLog,
          version: getAppVersion(),
        },
      }
      for (const k of AGENT_KINDS) {
        const p = agentPaths[k]
        if (p) status.agents[k].path = p
      }
      if (ghWhich) status.gh.path = ghWhich
      return status
    },
  }

  const app = createApp(deps)
  log.info('binding port', { requested: configState.port })
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: configState.port }, (info) => {
      port = info.port
      resolve(s)
    })
  })
  log.info('server listening', { port })
  writeFileSync(
    paths.serverJson,
    JSON.stringify({ pid: process.pid, port, startedAt, version: getAppVersion() }),
  )
  log.info('daemon started', { pid: process.pid, port })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    bus.emit({ type: 'shutting-down' })
    await new Promise<void>((res) => {
      server.close(() => res())
      if ('closeAllConnections' in server) server.closeAllConnections()
    })
    // Kick any active agent children so their runners settle into a
    // final status, then wait for the queue to drain so in-flight
    // start-session promises write their final rows on a still-open
    // connection. Without this the catch handlers in start-session /
    // runner can fire after db.close() and crash with "database
    // connection is not open".
    try {
      await runners.cancelAll()
    } catch (e) {
      log.warn('cancelAll errored during shutdown', { error: (e as Error).message })
    }
    await queue.quiesce(5_000)
    try {
      db.close()
    } catch {
      /* already closed */
    }
    if (existsSync(paths.serverJson)) {
      try {
        rmSync(paths.serverJson)
      } catch {
        /* ignore */
      }
    }
    log.info('daemon stopped')
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())

  return { port, pid: process.pid, shutdown }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDaemon()
    .then((h) => process.stdout.write(`daemon listening on ${h.port}\n`))
    .catch((e) => {
      process.stderr.write(`daemon failed: ${(e as Error).message}\n`)
      process.exit(1)
    })
}
