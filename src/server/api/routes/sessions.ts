import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Hono } from 'hono'

import { AGENT_KINDS, type AgentKind } from '../../../shared/types'
import type { AppDeps } from '../app'

function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value)
}

export function sessionsRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.get('/sessions', (c) => c.json(deps.sessions.list()))
  r.post('/sessions', async (c) => {
    const body = await c.req.json<{
      prInput: string
      agent?: unknown
      localRepoPath?: unknown
    }>()
    if (!body?.prInput) return c.json({ error: 'prInput required' }, 400)
    if (body.agent !== undefined && !isAgentKind(body.agent)) {
      return c.json({ error: `unknown agent: ${String(body.agent)}` }, 400)
    }
    if (body.localRepoPath !== undefined && typeof body.localRepoPath !== 'string') {
      return c.json({ error: 'localRepoPath must be a string' }, 400)
    }
    try {
      const input: { prInput: string; agent?: AgentKind; localRepoPath?: string } = {
        prInput: body.prInput,
      }
      if (body.agent !== undefined) input.agent = body.agent
      if (typeof body.localRepoPath === 'string' && body.localRepoPath.trim().length > 0) {
        input.localRepoPath = body.localRepoPath
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
    let body: { agent?: unknown } = {}
    if (c.req.header('content-type')?.includes('application/json')) {
      try {
        body = await c.req.json<{ agent?: unknown }>()
      } catch {
        body = {}
      }
    }
    if (body.agent !== undefined && !isAgentKind(body.agent)) {
      return c.json({ error: `unknown agent: ${String(body.agent)}` }, 400)
    }
    try {
      const result = await deps.rerunSession(c.req.param('id'), body.agent as AgentKind | undefined)
      return c.json(result, 202)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  return r
}
