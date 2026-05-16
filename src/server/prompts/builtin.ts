import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Language } from '../../shared/types'

const here = dirname(fileURLToPath(import.meta.url))

// Exported for testing. Order matters: dist layout first (where the npm package
// puts assets at <pkg>/dist/prompts/, with builtin.js at <pkg>/dist/server/prompts/),
// then dev layout (with this file at <repo>/src/server/prompts/ and assets at
// <repo>/prompts/), then a legacy fallback one level higher.
export function getBuiltinPromptDirs(fromDir: string): string[] {
  return [
    resolve(fromDir, '../../prompts'),
    resolve(fromDir, '../../../prompts'),
    resolve(fromDir, '../../../../prompts'),
  ]
}

function load(name: string): string {
  for (const dir of getBuiltinPromptDirs(here)) {
    try {
      return readFileSync(resolve(dir, name), 'utf8')
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
