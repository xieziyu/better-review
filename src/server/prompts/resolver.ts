import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getBuiltinRules, getFramework } from './builtin'

export type RulesSource = 'project' | 'global' | 'builtin'

export interface ResolvedRules {
  source: RulesSource
  content: string
  path: string | null
}

export interface ResolvedPrompt {
  framework: string
  rules: ResolvedRules
  effective: string
}

export function resolveEffectiveRules(opts: { cwd: string; home: string }): ResolvedRules {
  const project = join(opts.cwd, '.better-review', 'review.md')
  if (existsSync(project))
    return { source: 'project', content: readFileSync(project, 'utf8'), path: project }
  const global = join(opts.home, 'review.md')
  if (existsSync(global))
    return { source: 'global', content: readFileSync(global, 'utf8'), path: global }
  return { source: 'builtin', content: getBuiltinRules(), path: null }
}

export function resolveEffectivePrompt(opts: { cwd: string; home: string }): ResolvedPrompt {
  const framework = getFramework()
  const rules = resolveEffectiveRules(opts)
  const effective = framework.replaceAll('{{RULES}}', rules.content)
  return { framework, rules, effective }
}
