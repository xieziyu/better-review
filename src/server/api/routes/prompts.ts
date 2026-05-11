import { Hono } from 'hono'

import { getFramework } from '../../prompts/builtin'
import { resolveEffectiveRules } from '../../prompts/resolver'
import type { AppDeps } from '../app'

export function promptsRoutes(deps: AppDeps): Hono {
  const r = new Hono()
  r.get('/prompts', (c) => {
    const lang = deps.getConfig().language
    const rules = resolveEffectiveRules({ cwd: deps.promptCwd, home: deps.promptHome, lang })
    const project = deps.promptStore.read('project')
    const global = deps.promptStore.read('global')
    return c.json({
      framework: { content: getFramework(lang) },
      rules: {
        effective: { source: rules.source, content: rules.content, path: rules.path },
        scopes: {
          project: {
            exists: project !== null,
            content: project,
            path: deps.promptStore.pathOf('project'),
          },
          global: {
            exists: global !== null,
            content: global,
            path: deps.promptStore.pathOf('global'),
          },
        },
      },
    })
  })
  r.put('/prompts/:scope', async (c) => {
    const scope = c.req.param('scope')
    if (scope !== 'project' && scope !== 'global') {
      return c.json({ error: 'invalid scope' }, 400)
    }
    const { content } = await c.req.json<{ content: string }>()
    if (typeof content !== 'string') {
      return c.json({ error: 'content required' }, 400)
    }
    deps.promptStore.write(scope, content)
    return c.json({ ok: true })
  })
  r.delete('/prompts/:scope', (c) => {
    const scope = c.req.param('scope')
    if (scope !== 'project' && scope !== 'global') {
      return c.json({ error: 'invalid scope' }, 400)
    }
    deps.promptStore.delete(scope)
    return c.body(null, 204)
  })
  return r
}
