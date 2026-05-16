import { Hono } from 'hono'

import { manualFindingInputSchema } from '../../../shared/findings-schema'
import type { UpdateFindingPatch } from '../../db/findings'
import type { AppDeps } from '../app'

export function findingsRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.patch('/findings/:id', async (c) => {
    const id = c.req.param('id')
    const cur = deps.findings.getById(id)
    if (!cur) return c.json({ error: 'not found' }, 404)
    const patch = (await c.req.json()) as UpdateFindingPatch
    deps.findings.update(id, patch)
    const next = deps.findings.getById(id)!
    deps.bus.emit({ type: 'finding-updated', sessionId: next.sessionId, finding: next })
    return c.json(next)
  })
  r.patch('/findings/:id/select', async (c) => {
    const id = c.req.param('id')
    const cur = deps.findings.getById(id)
    if (!cur) return c.json({ error: 'not found' }, 404)
    const { selected } = await c.req.json<{ selected: boolean }>()
    deps.findings.setSelected(id, !!selected)
    const next = deps.findings.getById(id)!
    deps.bus.emit({ type: 'finding-updated', sessionId: next.sessionId, finding: next })
    return c.json(next)
  })
  r.delete('/findings/:id', (c) => {
    deps.findings.delete(c.req.param('id'))
    return c.body(null, 204)
  })
  r.post('/sessions/:id/findings/manual', async (c) => {
    const sessionId = c.req.param('id')
    const session = deps.sessions.getById(sessionId)
    if (!session) return c.json({ error: 'not found' }, 404)
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: 'invalid json' }, 400)
    }
    const parsed = manualFindingInputSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
    }
    const finding = deps.findings.insertManual(sessionId, parsed.data)
    deps.bus.emit({ type: 'finding-added', sessionId, finding })
    return c.json({ finding }, 201)
  })
  return r
}
