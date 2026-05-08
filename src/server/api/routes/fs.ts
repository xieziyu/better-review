import { Hono } from 'hono'

import type { AppDeps } from '../app'

export function fsRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.post('/fs/pick-directory', async (c) => {
    if (!deps.folderPicker.supported) {
      return c.json({ error: 'native folder picker is not supported on this platform' }, 501)
    }
    let body: { prompt?: unknown } = {}
    if (c.req.header('content-type')?.includes('application/json')) {
      try {
        body = await c.req.json<{ prompt?: unknown }>()
      } catch {
        body = {}
      }
    }
    try {
      const opts: { prompt?: string } = {}
      if (typeof body.prompt === 'string') opts.prompt = body.prompt
      const result = await deps.folderPicker.pick(opts)
      return c.json(result)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })
  return r
}
