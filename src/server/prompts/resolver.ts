import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Language } from '../../shared/types'
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

export interface ResolveOpts {
  cwd: string
  home: string
  lang: Language
}

export function resolveEffectiveRules(opts: ResolveOpts): ResolvedRules {
  const project = join(opts.cwd, '.better-review', 'review.md')
  if (existsSync(project))
    return { source: 'project', content: readFileSync(project, 'utf8'), path: project }
  const global = join(opts.home, 'review.md')
  if (existsSync(global))
    return { source: 'global', content: readFileSync(global, 'utf8'), path: global }
  return { source: 'builtin', content: getBuiltinRules(opts.lang), path: null }
}

export function resolveEffectivePrompt(opts: ResolveOpts): ResolvedPrompt {
  const framework = getFramework(opts.lang)
  const rules = resolveEffectiveRules(opts)
  const effective = framework.replaceAll('{{RULES}}', rules.content)
  return { framework, rules, effective }
}
