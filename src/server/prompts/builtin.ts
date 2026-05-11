import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Language } from '../../shared/types'

const here = dirname(fileURLToPath(import.meta.url))

function load(name: string): string {
  const candidates = [
    resolve(here, '../../../prompts', name),
    resolve(here, '../../../../prompts', name),
  ]
  for (const c of candidates) {
    try {
      return readFileSync(c, 'utf8')
    } catch {
      /* try next */
    }
  }
  throw new Error(`builtin prompt asset not found: ${name}`)
}

const frameworkCache = new Map<Language, string>()
const builtinRulesCache = new Map<Language, string>()

export function getFramework(lang: Language): string {
  let v = frameworkCache.get(lang)
  if (v === undefined) {
    v = load(`framework.${lang}.md`)
    frameworkCache.set(lang, v)
  }
  return v
}

export function getBuiltinRules(lang: Language): string {
  let v = builtinRulesCache.get(lang)
  if (v === undefined) {
    v = load(`builtin-rules.${lang}.md`)
    builtinRulesCache.set(lang, v)
  }
  return v
}
