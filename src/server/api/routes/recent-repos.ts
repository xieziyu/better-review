import { Hono } from 'hono'

import type { AppDeps } from '../app'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export function recentReposRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.get('/recent-repos', (c) => {
    const owner = c.req.query('owner') ?? ''
    const repo = c.req.query('repo') ?? ''
    const limitRaw = c.req.query('limit')
    const limit = limitRaw
      ? Math.min(Math.max(Number.parseInt(limitRaw, 10) || 0, 1), MAX_LIMIT)
      : DEFAULT_LIMIT
    const items = deps.sessions.recentRepos({ owner, repo }, limit)
    return c.json({ items })
  })
  return r
}
