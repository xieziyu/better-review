import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Language } from '../../shared/types'
import { projectPromptPath } from '../paths'
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
  // Absolute path of the local repo selected for this review, or null when no
  // local repo is pinned. The project tier resolves against this directory's
  // `.better-review/review.md` — never the daemon's cwd. Null skips the tier.
  projectDir: string | null
  home: string
  lang: Language
}

export function resolveEffectiveRules(opts: ResolveOpts): ResolvedRules {
  if (opts.projectDir !== null) {
    const project = projectPromptPath(opts.projectDir)
    if (existsSync(project))
      return { source: 'project', content: readFileSync(project, 'utf8'), path: project }
  }
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
