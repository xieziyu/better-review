import { Hono } from 'hono'

import { listLocalBranches } from '../../git/local-branch'
import { inspectLocalSource, isInsideGitWorkTree } from '../../gitbutler/inspect'
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
  // GET /api/local-source/branches?path=...
  //
  // Powers the Home "Local branch" tab HEAD/BASE pickers. Returns the
  // local branch list (newest commit first) plus the current HEAD
  // shortname. Non-git paths come back as kind='none' with an empty
  // list so the picker can render a friendly empty-state row.
  r.get('/local-source/branches', async (c) => {
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
      if (!(await isInsideGitWorkTree(resolved))) {
        return c.json({ kind: 'none', repoPath: resolved, head: null, branches: [] })
      }
      const { head, branches } = await listLocalBranches(resolved)
      return c.json({ kind: 'git', repoPath: resolved, head, branches })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })
  return r
}
