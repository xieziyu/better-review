import { Hono } from 'hono'

import { inspectLocalSource } from '../../gitbutler/inspect'
import { resolveLocalRepoPath } from '../../paths'
import type { AppDeps } from '../app'

// GET /api/local-source/inspect?path=...
//
// Quick probe used by the Home "Local branch" / "GitButler vbranch" tabs
// to figure out which form to show after the user picks a folder. The
// response is best-effort: a non-git directory returns kind='none', a
// plain git repo returns kind='git', and a fully set-up GitButler
// project returns kind='gitbutler' with the vbranch list pre-folded
// (stack-relative bases already resolved).
//
// We deliberately do NOT take a POST or any auth-relevant data here —
// this is read-only filesystem inspection, scoped by the originGuard
// middleware that already blocks remote callers.
export function localSourceRoutes(_deps: AppDeps): Hono {
  const r = new Hono()
  r.get('/local-source/inspect', async (c) => {
    const raw = c.req.query('path')
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return c.json({ error: 'path query parameter is required' }, 400)
    }
    let resolved: string
    try {
      resolved = resolveLocalRepoPath(raw.trim())
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
    try {
      const result = await inspectLocalSource(resolved)
      return c.json(result)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })
  return r
}
