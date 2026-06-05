import { Hono } from 'hono'
import { z, ZodError } from 'zod'

import { AGENT_KINDS, DIFF_VIEW_MODES, LANGUAGES } from '../../../shared/types'
import { saveConfig, type Config } from '../../config'
import type { AppDeps } from '../app'

const updatableSchema = z.object({
  port: z.number().int().min(0).max(65535),
  maxConcurrentReviews: z.number().int().min(1).max(16),
  stallMinutes: z.number().int().min(1).max(60),
  defaultAgent: z.enum(AGENT_KINDS),
  perPRGCDays: z.number().int().min(0).max(365),
  language: z.enum(LANGUAGES),
  reviewExcludeGlobs: z.array(z.string().max(200)).max(100),
  diffViewMode: z.enum(DIFF_VIEW_MODES),
})

// PATCH accepts any subset of the updatable fields and merges them over the
// current config server-side. This lets each UI control (the diff-layout
// toggle, the language switcher, the Settings form) persist only the fields it
// owns, so concurrent writes from different controls can't clobber each other
// by each round-tripping a full stale snapshot.
//
// `.strict()`: reject unknown keys with a 400 instead of silently stripping
// them. A partial endpoint that swallowed `{ diffViewmode: 'split' }` (typo) as
// a no-op 200 would let a stale client think it persisted a change it didn't.
const patchSchema = updatableSchema.partial().strict()

function zodError(e: unknown): string {
  return e instanceof ZodError
    ? e.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')
    : 'invalid body'
}

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
      return c.json({ error: zodError(e) }, 400)
    }
    try {
      saveConfig(deps.configFile, parsed)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
    deps.setConfig(parsed)
    return c.json({ config: parsed })
  })
  r.patch('/config', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    let partial: z.infer<typeof patchSchema>
    try {
      partial = patchSchema.parse(body)
    } catch (e) {
      return c.json({ error: zodError(e) }, 400)
    }
    // Runtime-safe spread: zod drops keys absent from the body (JSON can't carry
    // `undefined`), so merging never overwrites a present field with undefined.
    const merged: Config = { ...deps.getConfig(), ...partial } as Config
    try {
      saveConfig(deps.configFile, merged)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
    deps.setConfig(merged)
    return c.json({ config: merged })
  })
  return r
}
