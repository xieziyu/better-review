import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeEach } from 'vitest'

import { openDatabase } from '../../../src/server/db/connection'
import { FindingsRepo } from '../../../src/server/db/findings'
import { SessionsRepo } from '../../../src/server/db/sessions'
import { getAgent } from '../../../src/server/engine/agent'
import { EventBus } from '../../../src/server/engine/events'
import { runReview } from '../../../src/server/engine/runner'
import { RunnerRegistry } from '../../../src/server/engine/runner-registry'
import type { AgentKind, SSEEvent } from '../../../src/shared/types'

const here = dirname(fileURLToPath(import.meta.url))
const FAKE_CLAUDE = resolve(here, '../../fixtures/fake-claude.sh')
const FAKE_CODEX = resolve(here, '../../fixtures/fake-codex.sh')

interface AgentFixture {
  kind: AgentKind
  executable: string
  bodyEnv: string
  failEnv: string
  stallEnv: string
}

const FIXTURES: AgentFixture[] = [
  {
    kind: 'claude',
    executable: FAKE_CLAUDE,
    bodyEnv: 'FAKE_CLAUDE_BODY',
    failEnv: 'FAKE_CLAUDE_FAIL',
    stallEnv: 'FAKE_CLAUDE_STALL',
  },
  {
    kind: 'codex',
    executable: FAKE_CODEX,
    bodyEnv: 'FAKE_CODEX_BODY',
    failEnv: 'FAKE_CODEX_FAIL',
    stallEnv: 'FAKE_CODEX_STALL',
  },
]

describe.each(FIXTURES)('runReview ($kind happy path)', (fx) => {
  let workdir: string
  let sessions: SessionsRepo
  let findings: FindingsRepo
  let bus: EventBus
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-run-'))
    const db = openDatabase(join(dir, 's.db'))
    sessions = new SessionsRepo(db)
    findings = new FindingsRepo(db)
    bus = new EventBus()
    workdir = mkdtempSync(join(tmpdir(), 'br-run-wd-'))
    sessions.insert({
      id: 's1',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'running',
      agent: fx.kind,
      workdir,
      promptUsed: 'p',
    })
  })

  it('transitions to ready with empty findings when the agent reports nothing', async () => {
    process.env[fx.bodyEnv] = '[]'
    try {
      const events: SSEEvent[] = []
      bus.subscribeGlobal((e) => events.push(e))
      const promptText = `do review. FINDINGS_PATH=${join(workdir, 'findings.json')}`
      writeFileSync(join(workdir, 'prompt.txt'), promptText)
      await runReview({
        sessionId: 's1',
        workdir,
        prompt: promptText,
        agent: getAgent(fx.kind),
        executable: fx.executable,
        sessions,
        findings,
        bus,
        stallMs: 60_000,
        runners: new RunnerRegistry(),
      })
      const got = sessions.getById('s1')!
      expect(got.status).toBe('ready')
      expect(got.error).toBeNull()
      expect(findings.listBySession('s1')).toHaveLength(0)
      expect(events.some((e) => e.type === 'done')).toBe(true)
      expect(events.some((e) => e.type === 'error')).toBe(false)
    } finally {
      delete process.env[fx.bodyEnv]
    }
  })

  it('spawns the agent, parses findings.json, transitions to ready', async () => {
    const events: SSEEvent[] = []
    bus.subscribeGlobal((e) => events.push(e))
    const promptText = `do review. FINDINGS_PATH=${join(workdir, 'findings.json')}`
    writeFileSync(join(workdir, 'prompt.txt'), promptText)
    await runReview({
      sessionId: 's1',
      workdir,
      prompt: promptText,
      agent: getAgent(fx.kind),
      executable: fx.executable,
      sessions,
      findings,
      bus,
      stallMs: 60_000,
      runners: new RunnerRegistry(),
    })
    const got = sessions.getById('s1')!
    expect(got.status).toBe('ready')
    expect(findings.listBySession('s1')).toHaveLength(1)
    expect(events.some((e) => e.type === 'done')).toBe(true)
    expect(events.some((e) => e.type === 'finding-added')).toBe(true)
    const outputs = events.filter(
      (e): e is Extract<SSEEvent, { type: 'agent-output' }> => e.type === 'agent-output',
    )
    expect(outputs.length).toBeGreaterThan(0)
    expect(outputs.every((e) => typeof e.chunk === 'string' && e.chunk.length > 0)).toBe(true)
    expect(outputs.every((e) => typeof e.ts === 'number' && Number.isFinite(e.ts))).toBe(true)
    expect(outputs.every((e) => e.sessionId === 's1')).toBe(true)
    if (fx.kind === 'codex') {
      // Real codex writes most live progress to stderr — make sure we surface
      // those lines in agent-output, not just stdout.
      expect(outputs.some((e) => e.chunk === 'codex stderr banner')).toBe(true)
    }
  })
})

describe.each(FIXTURES)('runReview ($kind failure paths)', (fx) => {
  let workdir: string
  let sessions: SessionsRepo
  let findings: FindingsRepo
  let bus: EventBus
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-run-'))
    const db = openDatabase(join(dir, 's.db'))
    sessions = new SessionsRepo(db)
    findings = new FindingsRepo(db)
    bus = new EventBus()
    workdir = mkdtempSync(join(tmpdir(), 'br-run-wd-'))
    sessions.insert({
      id: 's2',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'running',
      agent: fx.kind,
      workdir,
      promptUsed: 'p',
    })
  })

  it('transitions to failed on non-zero exit', async () => {
    process.env[fx.failEnv] = '1'
    try {
      const promptText = `FINDINGS_PATH=${join(workdir, 'findings.json')}`
      await runReview({
        sessionId: 's2',
        workdir,
        prompt: promptText,
        agent: getAgent(fx.kind),
        executable: fx.executable,
        sessions,
        findings,
        bus,
        stallMs: 60_000,
        runners: new RunnerRegistry(),
      })
      expect(sessions.getById('s2')!.status).toBe('failed')
    } finally {
      delete process.env[fx.failEnv]
    }
  })

  it('kills a stalled agent and marks failed', async () => {
    process.env[fx.stallEnv] = '1'
    try {
      const promptText = `FINDINGS_PATH=${join(workdir, 'findings.json')}`
      await runReview({
        sessionId: 's2',
        workdir,
        prompt: promptText,
        agent: getAgent(fx.kind),
        executable: fx.executable,
        sessions,
        findings,
        bus,
        stallMs: 200,
        runners: new RunnerRegistry(),
      })
      expect(sessions.getById('s2')!.status).toBe('failed')
    } finally {
      delete process.env[fx.stallEnv]
    }
  }, 15_000)
})

describe('runReview (cancellation)', () => {
  let workdir: string
  let sessions: SessionsRepo
  let findings: FindingsRepo
  let bus: EventBus
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-run-'))
    const db = openDatabase(join(dir, 's.db'))
    sessions = new SessionsRepo(db)
    findings = new FindingsRepo(db)
    bus = new EventBus()
    workdir = mkdtempSync(join(tmpdir(), 'br-run-wd-'))
    sessions.insert({
      id: 'cancel-1',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'running',
      agent: 'claude',
      workdir,
      promptUsed: 'p',
    })
  })

  it('runners.cancel(id) resolves runReview without emitting status-changed: failed', async () => {
    process.env.FAKE_CLAUDE_STALL = '1'
    try {
      const events: SSEEvent[] = []
      bus.subscribeGlobal((e) => events.push(e))
      const runners = new RunnerRegistry()
      const promptText = `FINDINGS_PATH=${join(workdir, 'findings.json')}`
      const run = runReview({
        sessionId: 'cancel-1',
        workdir,
        prompt: promptText,
        agent: getAgent('claude'),
        executable: FAKE_CLAUDE,
        sessions,
        findings,
        bus,
        stallMs: 60_000,
        runners,
      })
      await new Promise((r) => setTimeout(r, 200))
      expect(runners.isRunning('cancel-1')).toBe(true)
      await runners.cancel('cancel-1')
      await run

      const got = sessions.getById('cancel-1')!
      expect(got.status).toBe('running')
      expect(got.error).toBeNull()
      expect(events.some((e) => e.type === 'status-changed' && e.status === 'failed')).toBe(false)
      expect(events.some((e) => e.type === 'done')).toBe(false)
      expect(runners.isRunning('cancel-1')).toBe(false)
    } finally {
      delete process.env.FAKE_CLAUDE_STALL
    }
  }, 15_000)
})

describe('runReview (claude result-after-linger)', () => {
  let workdir: string
  let sessions: SessionsRepo
  let findings: FindingsRepo
  let bus: EventBus
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'br-run-'))
    const db = openDatabase(join(dir, 's.db'))
    sessions = new SessionsRepo(db)
    findings = new FindingsRepo(db)
    bus = new EventBus()
    workdir = mkdtempSync(join(tmpdir(), 'br-run-wd-'))
    sessions.insert({
      id: 's3',
      owner: 'o',
      repo: 'r',
      number: 1,
      title: null,
      author: null,
      url: null,
      baseRef: null,
      headRef: null,
      status: 'running',
      agent: 'claude',
      workdir,
      promptUsed: 'p',
    })
  })

  it('marks session ready when claude emits result then lingers past stallMs', async () => {
    process.env.FAKE_CLAUDE_LINGER = '1'
    try {
      const events: SSEEvent[] = []
      bus.subscribeGlobal((e) => events.push(e))
      const promptText = `FINDINGS_PATH=${join(workdir, 'findings.json')}`
      writeFileSync(join(workdir, 'prompt.txt'), promptText)
      await runReview({
        sessionId: 's3',
        workdir,
        prompt: promptText,
        agent: getAgent('claude'),
        executable: FAKE_CLAUDE,
        sessions,
        findings,
        bus,
        stallMs: 500,
        runners: new RunnerRegistry(),
      })
      const got = sessions.getById('s3')!
      expect(got.status).toBe('ready')
      expect(got.error).toBeNull()
      expect(findings.listBySession('s3')).toHaveLength(1)
      expect(events.some((e) => e.type === 'done')).toBe(true)
      expect(events.some((e) => e.type === 'error')).toBe(false)
    } finally {
      delete process.env.FAKE_CLAUDE_LINGER
    }
  }, 15_000)
})
