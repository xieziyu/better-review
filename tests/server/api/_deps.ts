import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppDeps } from '../../../src/server/api/app'
import { makeCancelSession } from '../../../src/server/cancel-session'
import type { Config } from '../../../src/server/config'
import { openDatabase } from '../../../src/server/db/connection'
import { FindingsRepo } from '../../../src/server/db/findings'
import { SessionsRepo } from '../../../src/server/db/sessions'
import { SubmissionCommentsRepo } from '../../../src/server/db/submission-comments'
import { SubmissionsRepo } from '../../../src/server/db/submissions'
import { makeDeleteSession } from '../../../src/server/delete-session'
import { EventBus } from '../../../src/server/engine/events'
import { ConcurrencyQueue } from '../../../src/server/engine/queue'
import { RunnerRegistry } from '../../../src/server/engine/runner-registry'
import type { FolderPicker } from '../../../src/server/fs/folder-picker'
import type { GhClient } from '../../../src/server/github/gh-client'
import { PromptStore } from '../../../src/server/prompts/store'

export interface DepsOverrides {
  startSession?: AppDeps['startSession']
  rerunSession?: AppDeps['rerunSession']
  deleteSession?: AppDeps['deleteSession']
  cancelSession?: AppDeps['cancelSession']
  submitSession?: AppDeps['submitSession']
  health?: AppDeps['health']
  folderPicker?: FolderPicker
  sessionsDir?: string
  config?: Config
  configFile?: string
}

export function makeTestDeps(overrides: DepsOverrides = {}): AppDeps {
  const cwd = mkdtempSync(join(tmpdir(), 'br-pcwd-'))
  const home = mkdtempSync(join(tmpdir(), 'br-phome-'))
  const dbDir = mkdtempSync(join(tmpdir(), 'br-api-'))
  const db = openDatabase(join(dbDir, 's.db'))
  const sessions = new SessionsRepo(db)
  const submissions = new SubmissionsRepo(db)
  const submissionComments = new SubmissionCommentsRepo(db)
  const queue = new ConcurrencyQueue(1)
  const runners = new RunnerRegistry()
  const sessionsDir = overrides.sessionsDir ?? mkdtempSync(join(tmpdir(), 'br-sessions-'))
  const bus = new EventBus()
  let configState: Config = overrides.config ?? {
    port: 5555,
    maxConcurrentReviews: 1,
    stallMinutes: 1,
    defaultAgent: 'claude',
    perPRGCDays: 1,
    language: 'en',
  }
  const defaultDelete = makeDeleteSession({
    db,
    sessions,
    submissions,
    queue,
    runners,
    sessionsDir,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  })
  const defaultCancel = makeCancelSession({ sessions, queue, runners, bus })
  return {
    sessions,
    findings: new FindingsRepo(db),
    submissions,
    submissionComments,
    bus,
    gh: {} as GhClient,
    promptStore: new PromptStore({ cwd, home }),
    promptCwd: cwd,
    promptHome: home,
    folderPicker: overrides.folderPicker ?? {
      kind: 'unsupported',
      supported: false,
      pick: async () => {
        throw new Error('not supported in tests')
      },
    },
    getConfig: () => configState,
    setConfig: (next) => {
      configState = next
    },
    configFile: overrides.configFile ?? join(home, 'config.json'),
    getPort: () => 5555,
    startSession: overrides.startSession ?? (async () => ({ id: 'new1' })),
    rerunSession: overrides.rerunSession ?? (async () => ({ id: 'fresh1' })),
    deleteSession: overrides.deleteSession ?? defaultDelete,
    cancelSession: overrides.cancelSession ?? defaultCancel,
    submitSession:
      overrides.submitSession ??
      (async () => ({ url: 'https://gh', droppedToBody: [], skippedDuplicates: 0 })),
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
        fs: { folderPicker: { supported: false } },
        daemon: {
          pid: 1,
          port: 5555,
          startedAt: 1,
          home,
          logPath: join(home, 'daemon.log'),
        },
      })),
  }
}
