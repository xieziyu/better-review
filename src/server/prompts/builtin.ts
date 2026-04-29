import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

let frameworkCache: string | null = null
let builtinRulesCache: string | null = null

export function getFramework(): string {
  if (frameworkCache === null) frameworkCache = load('framework.md')
  return frameworkCache
}

export function getBuiltinRules(): string {
  if (builtinRulesCache === null) builtinRulesCache = load('builtin-rules.md')
  return builtinRulesCache
}
