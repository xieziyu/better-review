import { Hono } from 'hono'

import type { ReviewEvent } from '../../../shared/types'
import type { AppDeps } from '../app'

const VALID: ReviewEvent[] = ['COMMENT', 'REQUEST_CHANGES', 'APPROVE']

export function submitRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.post('/sessions/:id/submit', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json<{ event?: ReviewEvent; body?: string }>()
    if (!body?.event || !VALID.includes(body.event)) {
      return c.json({ error: 'event required' }, 400)
    }
    const session = deps.sessions.getById(id)
    if (!session) return c.json({ error: 'not found' }, 404)
    if (session.status === 'archived') return c.json({ error: 'session archived' }, 409)
    try {
      const out = await deps.submitSession(id, body.event, body.body)
      return c.json(out)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502)
    }
  })
  return r
}
