import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import { AGENT_KINDS, LANGUAGES, type Language } from '../shared/types'

// Picks the supported locale that best matches the host. Used as the initial
// default for `config.language` so a fresh install reflects the user's system
// instead of always landing on English. Once the user saves config (whether by
// changing language or any other field), the resolved value is persisted and
// further OS-locale changes won't affect the app.
export function detectSystemLanguage(): Language {
  // Use the first explicit POSIX locale signal; fall back to ICU if none set.
  // Env wins over Intl so users who set LANG explicitly get what they asked for.
  let signal: string | null = null
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const v = process.env[key]
    if (v) {
      signal = v
      break
    }
  }
  if (!signal) {
    try {
      signal = Intl.DateTimeFormat().resolvedOptions().locale
    } catch {
      // Intl unavailable — fall through to default.
    }
  }
  if (signal && signal.toLowerCase().startsWith('zh')) return 'zh-CN'
  return 'en'
}

const rawConfigSchema = z.object({
  port: z.number().int().nonnegative().default(0),
  maxConcurrentReviews: z.number().int().positive().default(4),
  stallMinutes: z.number().int().positive().default(3),
  defaultAgent: z.enum(AGENT_KINDS).default('codex'),
  perPRGCDays: z.number().int().nonnegative().default(7),
  language: z.enum(LANGUAGES).default(() => detectSystemLanguage()),
  // Deprecated alias kept for backward compatibility — superseded by `stallMinutes`.
  claudeStallMinutes: z.number().int().positive().optional(),
})

export type Config = z.infer<typeof rawConfigSchema>

export const defaultConfig: Config = rawConfigSchema.parse({})

export interface LoadConfigResult {
  config: Config
  // Deprecation messages emitted while reading the file (logged by the caller).
  warnings: string[]
}

function applyLegacyAliases(parsed: Config): { config: Config; warnings: string[] } {
  const warnings: string[] = []
  let stall = parsed.stallMinutes
  if (parsed.claudeStallMinutes !== undefined) {
    if (stall === defaultConfig.stallMinutes) {
      stall = parsed.claudeStallMinutes
    }
    warnings.push(
      'config.claudeStallMinutes is deprecated; rename it to stallMinutes (applies to all agents).',
    )
  }
  return {
    config: { ...parsed, stallMinutes: stall },
    warnings,
  }
}

export function loadConfig(home: string): Config {
  return loadConfigWithWarnings(home).config
}

export function loadConfigWithWarnings(home: string): LoadConfigResult {
  const file = join(home, 'config.json')
  if (!existsSync(file)) return { config: defaultConfig, warnings: [] }
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const parsed = rawConfigSchema.parse(raw)
  return applyLegacyAliases(parsed)
}

const writableKeys = [
  'port',
  'maxConcurrentReviews',
  'stallMinutes',
  'defaultAgent',
  'perPRGCDays',
  'language',
] as const

export function saveConfig(file: string, config: Config): void {
  const out: Record<string, unknown> = {}
  for (const k of writableKeys) out[k] = config[k]
  // Deprecated `claudeStallMinutes` is intentionally dropped — `loadConfig`
  // already coalesces it into `stallMinutes` on read.
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
}
