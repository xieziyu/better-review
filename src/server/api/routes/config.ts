import { Hono } from 'hono'
import { z, ZodError } from 'zod'

import { AGENT_KINDS, LANGUAGES } from '../../../shared/types'
import { saveConfig, type Config } from '../../config'
import type { AppDeps } from '../app'

const updatableSchema = z.object({
  port: z.number().int().min(0).max(65535),
  maxConcurrentReviews: z.number().int().min(1).max(16),
  stallMinutes: z.number().int().min(1).max(60),
  defaultAgent: z.enum(AGENT_KINDS),
  perPRGCDays: z.number().int().min(0).max(365),
  language: z.enum(LANGUAGES),
})

export function configRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.get('/config', (c) => c.json({ config: deps.getConfig(), file: deps.configFile }))
  r.put('/config', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    let parsed: Config
    try {
      parsed = updatableSchema.parse(body)
    } catch (e) {
      const msg =
        e instanceof ZodError
          ? e.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')
          : 'invalid body'
      return c.json({ error: msg }, 400)
    }
    try {
      saveConfig(deps.configFile, parsed)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
    deps.setConfig(parsed)
    return c.json({ config: parsed })
  })
  return r
}
