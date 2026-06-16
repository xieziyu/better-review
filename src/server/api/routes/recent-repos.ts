import { Hono } from 'hono'

import { repoMatchesGithubRepo } from '../../git/remote-match'
import type { AppDeps } from '../app'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export function recentReposRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.get('/recent-repos', async (c) => {
    const owner = c.req.query('owner') ?? ''
    const repo = c.req.query('repo') ?? ''
    const limitRaw = c.req.query('limit')
    const limit = limitRaw
      ? Math.min(Math.max(Number.parseInt(limitRaw, 10) || 0, 1), MAX_LIMIT)
      : DEFAULT_LIMIT
    const items = deps.sessions.recentRepos({ owner, repo }, limit)

    // The DB only knows owner/repo for past github-pr sessions. A directory
    // reviewed solely as a local branch carries no owner/repo, so it never
    // matches a pasted PR URL by history alone. Fall back to inspecting each
    // candidate's git remotes so e.g. reviewing this repo's own PR auto-fills
    // its local path. Cheap (a `git remote -v` per unmatched repo) and only
    // runs when an owner/repo filter is present.
    if (owner && repo) {
      await Promise.all(
        items.map(async (it) => {
          if (it.matchedCurrentRepo) return
          if (await repoMatchesGithubRepo(it.path, owner, repo)) {
            it.matchedCurrentRepo = true
          }
        }),
      )
      items.sort((a, b) => {
        if (a.matchedCurrentRepo !== b.matchedCurrentRepo) {
          return a.matchedCurrentRepo ? -1 : 1
        }
        return b.lastUsedAt - a.lastUsedAt
      })
    }

    return c.json({ items })
  })
  return r
}
