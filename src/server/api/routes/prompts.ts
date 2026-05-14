import { Hono } from 'hono'

import type { PromptScopeState } from '../../../shared/types'
import { resolveLocalRepoPath } from '../../paths'
import { getFramework } from '../../prompts/builtin'
import { resolveEffectiveRules } from '../../prompts/resolver'
import type { AppDeps } from '../app'

// Validates a user-supplied repo path. Returns the absolute path, or an error
// message suitable for a 400 response. The project scope of prompt overrides
// is repo-scoped — it lives inside the selected local repo, not the daemon cwd.
function parseRepo(raw: string | undefined): { repo: string } | { error: string } {
  if (raw === undefined || raw.trim().length === 0) return { error: 'repo is required' }
  try {
    return { repo: resolveLocalRepoPath(raw) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export function promptsRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.get('/prompts', (c) => {
    const lang = deps.getConfig().language
    const repoRaw = c.req.query('repo')
    let repo: string | null = null
    if (repoRaw !== undefined && repoRaw.trim().length > 0) {
      const parsed = parseRepo(repoRaw)
      if ('error' in parsed) return c.json({ error: parsed.error }, 400)
      repo = parsed.repo
    }

    const rules = resolveEffectiveRules({ projectDir: repo, home: deps.promptHome, lang })
    const global = deps.promptStore.read('global')
    const globalState: PromptScopeState = {
      exists: global !== null,
      content: global,
      path: deps.promptStore.pathOf('global'),
    }
    let projectState: PromptScopeState
    if (repo === null) {
      projectState = { exists: false, content: null, path: null }
    } else {
      const project = deps.promptStore.read('project', repo)
      projectState = {
        exists: project !== null,
        content: project,
        path: deps.promptStore.pathOf('project', repo),
      }
    }

    return c.json({
      repo,
      framework: { content: getFramework(lang) },
      rules: {
        effective: { source: rules.source, content: rules.content, path: rules.path },
        scopes: { global: globalState, project: projectState },
      },
    })
  })
  r.put('/prompts/:scope', async (c) => {
    const scope = c.req.param('scope')
    if (scope !== 'project' && scope !== 'global') {
      return c.json({ error: 'invalid scope' }, 400)
    }
    const body = await c.req.json<{ content?: unknown; repo?: unknown }>()
    if (typeof body.content !== 'string') {
      return c.json({ error: 'content required' }, 400)
    }
    if (scope === 'global') {
      deps.promptStore.write('global', body.content)
      return c.json({ ok: true })
    }
    const parsed = parseRepo(typeof body.repo === 'string' ? body.repo : undefined)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    deps.promptStore.write('project', body.content, parsed.repo)
    return c.json({ ok: true })
  })
  r.delete('/prompts/:scope', (c) => {
    const scope = c.req.param('scope')
    if (scope !== 'project' && scope !== 'global') {
      return c.json({ error: 'invalid scope' }, 400)
    }
    if (scope === 'global') {
      deps.promptStore.delete('global')
      return c.body(null, 204)
    }
    const parsed = parseRepo(c.req.query('repo'))
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    deps.promptStore.delete('project', parsed.repo)
    return c.body(null, 204)
  })
  return r
}
