import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppDeps } from '../../../src/server/api/app'
import { openDatabase } from '../../../src/server/db/connection'
import { FindingsRepo } from '../../../src/server/db/findings'
import { SessionsRepo } from '../../../src/server/db/sessions'
import { SubmissionsRepo } from '../../../src/server/db/submissions'
import { makeDeleteSession } from '../../../src/server/delete-session'
import { EventBus } from '../../../src/server/engine/events'
import { ConcurrencyQueue } from '../../../src/server/engine/queue'
import { RunnerRegistry } from '../../../src/server/engine/runner-registry'
import type { GhClient } from '../../../src/server/github/gh-client'
import { PromptStore } from '../../../src/server/prompts/store'

export interface DepsOverrides {
  startSession?: AppDeps['startSession']
  rerunSession?: AppDeps['rerunSession']
  deleteSession?: AppDeps['deleteSession']
  submitSession?: AppDeps['submitSession']
  health?: AppDeps['health']
  sessionsDir?: string
}

export function makeTestDeps(overrides: DepsOverrides = {}): AppDeps {
  const cwd = mkdtempSync(join(tmpdir(), 'br-pcwd-'))
  const home = mkdtempSync(join(tmpdir(), 'br-phome-'))
  const dbDir = mkdtempSync(join(tmpdir(), 'br-api-'))
  const db = openDatabase(join(dbDir, 's.db'))
  const sessions = new SessionsRepo(db)
  const submissions = new SubmissionsRepo(db)
  const queue = new ConcurrencyQueue(1)
  const runners = new RunnerRegistry()
  const sessionsDir = overrides.sessionsDir ?? mkdtempSync(join(tmpdir(), 'br-sessions-'))
  const defaultDelete = makeDeleteSession({
    db,
    sessions,
    submissions,
    queue,
    runners,
    sessionsDir,
  })
  return {
    sessions,
    findings: new FindingsRepo(db),
    submissions,
    bus: new EventBus(),
    gh: {} as GhClient,
    promptStore: new PromptStore({ cwd, home }),
    promptCwd: cwd,
    promptHome: home,
    config: {
      port: 5555,
      idleShutdownMinutes: 1,
      maxConcurrentReviews: 1,
      stallMinutes: 1,
      defaultAgent: 'claude',
      perPRGCDays: 1,
    },
    getPort: () => 5555,
    startSession: overrides.startSession ?? (async () => ({ id: 'new1' })),
    rerunSession: overrides.rerunSession ?? (async () => ({ id: 'fresh1' })),
    deleteSession: overrides.deleteSession ?? defaultDelete,
    submitSession:
      overrides.submitSession ?? (async () => ({ url: 'https://gh', droppedToBody: [] })),
    health:
      overrides.health ??
      (async () => ({
        ok: true,
        agents: {
          claude: { found: true, path: '/usr/bin/claude' },
          codex: { found: false },
        },
        defaultAgent: 'claude',
        gh: { found: true, path: '/usr/bin/gh', authed: true },
        daemon: { pid: 1, port: 5555, startedAt: 1 },
      })),
  }
}
