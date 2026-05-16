import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Hono } from 'hono'

import {
  AGENT_KINDS,
  type AgentKind,
  type PrepCall,
  type PrepStep,
} from '../../../shared/types'
import { getAgent } from '../../engine/agent'
import type { AppDeps } from '../app'

function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value)
}

// Cap how much of agent.log we replay into a completed session's transcript.
// stream-json logs can run to MBs; the tail is what's worth showing.
const TRANSCRIPT_TAIL_LINES = 2000

// Cap how many gh-call entries we replay from prep.log. Each call carries the
// full untruncated stdout/stderr; a misbehaving session with hundreds of
// paginated `gh api` calls would otherwise serialize a multi-MB JSON body.
// Phase markers are never dropped — only `kind:'call'` entries get tail-capped.
const PREP_LOG_TAIL_CALLS = 200

export function sessionsRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.get('/sessions', (c) => c.json(deps.sessions.list()))
  r.post('/sessions', async (c) => {
    const body = await c.req.json<{
      prInput: string
      agent?: unknown
      localRepoPath?: unknown
      extraPrompt?: unknown
    }>()
    if (!body?.prInput) return c.json({ error: 'prInput required' }, 400)
    if (body.agent !== undefined && !isAgentKind(body.agent)) {
      return c.json({ error: `unknown agent: ${String(body.agent)}` }, 400)
    }
    if (body.localRepoPath !== undefined && typeof body.localRepoPath !== 'string') {
      return c.json({ error: 'localRepoPath must be a string' }, 400)
    }
    if (body.extraPrompt !== undefined && typeof body.extraPrompt !== 'string') {
      return c.json({ error: 'extraPrompt must be a string' }, 400)
    }
    try {
      const input: {
        prInput: string
        agent?: AgentKind
        localRepoPath?: string
        extraPrompt?: string
      } = {
        prInput: body.prInput,
      }
      if (body.agent !== undefined) input.agent = body.agent
      if (typeof body.localRepoPath === 'string' && body.localRepoPath.trim().length > 0) {
        input.localRepoPath = body.localRepoPath
      }
      if (typeof body.extraPrompt === 'string' && body.extraPrompt.trim().length > 0) {
        input.extraPrompt = body.extraPrompt
      }
      const { id } = await deps.startSession(input)
      return c.json({ id }, 201)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  r.get('/sessions/:id', (c) => {
    const id = c.req.param('id')
    const s = deps.sessions.getById(id)
    if (!s) return c.json({ error: 'not found' }, 404)
    return c.json({ session: s, findings: deps.findings.listBySession(id) })
  })
  r.get('/sessions/:id/diff', (c) => {
    const id = c.req.param('id')
    const s = deps.sessions.getById(id)
    if (!s) return c.json({ error: 'not found' }, 404)
    const cache = join(s.workdir, 'diff.cache')
    const diff = existsSync(cache) ? readFileSync(cache, 'utf8') : null
    return c.json({ diff })
  })
  // Replay the persisted agent.log into transcript lines so completed
  // sessions keep a read-only view of their last run after a page reload
  // (the live agent-output SSE stream is gone once the session ends).
  r.get('/sessions/:id/transcript', (c) => {
    const id = c.req.param('id')
    const s = deps.sessions.getById(id)
    if (!s) return c.json({ error: 'not found' }, 404)
    const logPath = join(s.workdir, 'agent.log')
    if (!existsSync(logPath)) return c.json({ chunks: [], truncated: false })
    const lines = readFileSync(logPath, 'utf8').split('\n')
    const truncated = lines.length > TRANSCRIPT_TAIL_LINES
    const tail = truncated ? lines.slice(-TRANSCRIPT_TAIL_LINES) : lines
    const chunks = getAgent(s.agent).parseLog(tail.join('\n'))
    return c.json({ chunks, truncated })
  })
  // Replay the persisted prep.log so refresh during prep does not lose the
  // phase timeline or any captured gh stdout/stderr. Mirrors /transcript.
  r.get('/sessions/:id/prep-log', (c) => {
    const id = c.req.param('id')
    const s = deps.sessions.getById(id)
    if (!s) return c.json({ error: 'not found' }, 404)
    const logPath = join(s.workdir, 'prep.log')
    if (!existsSync(logPath)) {
      return c.json({ phases: [], calls: [], truncated: false })
    }
    const phases: PrepStep[] = []
    const calls: PrepCall[] = []
    const lines = readFileSync(logPath, 'utf8').split('\n')
    for (const line of lines) {
      if (line.length === 0) continue
      let entry: unknown
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (!entry || typeof entry !== 'object') continue
      const e = entry as { kind?: unknown }
      if (e.kind === 'phase') {
        const p = entry as { phase: string; ts: number; detail?: string }
        const step: PrepStep = { phase: p.phase, ts: p.ts }
        if (p.detail !== undefined) step.detail = p.detail
        phases.push(step)
      } else if (e.kind === 'call') {
        const call = entry as PrepCall & { kind: string }
        calls.push({
          phase: call.phase,
          command: call.command,
          stdout: call.stdout,
          stderr: call.stderr,
          exitCode: call.exitCode,
          durationMs: call.durationMs,
          ts: call.ts,
        })
      }
    }
    const truncated = calls.length > PREP_LOG_TAIL_CALLS
    const tailCalls = truncated ? calls.slice(-PREP_LOG_TAIL_CALLS) : calls
    return c.json({ phases, calls: tailCalls, truncated })
  })
  r.delete('/sessions/:id', async (c) => {
    try {
      await deps.deleteSession(c.req.param('id'))
      return c.body(null, 204)
    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'not found') return c.json({ error: msg }, 404)
      return c.json({ error: msg }, 500)
    }
  })
  r.post('/sessions/:id/cancel', async (c) => {
    try {
      await deps.cancelSession(c.req.param('id'))
      return c.body(null, 204)
    } catch (e) {
      const msg = (e as Error).message
      if (msg === 'not found') return c.json({ error: msg }, 404)
      if (msg === 'not running') return c.json({ error: msg }, 409)
      return c.json({ error: msg }, 500)
    }
  })
  r.post('/sessions/:id/rerun', async (c) => {
    let body: { agent?: unknown; extraPrompt?: unknown } = {}
    if (c.req.header('content-type')?.includes('application/json')) {
      try {
        body = await c.req.json<{ agent?: unknown; extraPrompt?: unknown }>()
      } catch {
        body = {}
      }
    }
    if (body.agent !== undefined && !isAgentKind(body.agent)) {
      return c.json({ error: `unknown agent: ${String(body.agent)}` }, 400)
    }
    if (body.extraPrompt !== undefined && typeof body.extraPrompt !== 'string') {
      return c.json({ error: 'extraPrompt must be a string' }, 400)
    }
    try {
      const opts: { agent?: AgentKind; extraPrompt?: string } = {}
      if (body.agent !== undefined) opts.agent = body.agent as AgentKind
      if (typeof body.extraPrompt === 'string') opts.extraPrompt = body.extraPrompt
      const result = await deps.rerunSession(c.req.param('id'), opts)
      return c.json(result, 202)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  return r
}
