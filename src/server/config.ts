import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import {
  AGENT_KINDS,
  DIFF_VIEW_MODES,
  LANGUAGES,
  type AgentKind,
  type Language,
} from '../shared/types'

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
  diffViewMode: z.enum(DIFF_VIEW_MODES).default('unified'),
  // Extra glob patterns for files to drop from the review-agent prompt, on top
  // of the built-in lockfile/generated defaults. See engine/diff-filter.ts.
  reviewExcludeGlobs: z.array(z.string()).default([]),
  // Deprecated alias kept for backward compatibility — superseded by `stallMinutes`.
  claudeStallMinutes: z.number().int().positive().optional(),
})

export type Config = z.infer<typeof rawConfigSchema>

export const defaultConfig: Config = rawConfigSchema.parse({})

export interface LoadConfigResult {
  config: Config
  // Deprecation messages emitted while reading the file (logged by the caller).
  warnings: string[]
  // True iff the on-disk config.json had a `defaultAgent` key. Used by the
  // daemon to decide whether it may auto-switch to an installed agent on boot:
  // user-explicit values are always respected, defaults can be overridden.
  defaultAgentExplicit: boolean
}

type AliasedConfig = { config: Config; warnings: string[] }

function applyLegacyAliases(parsed: Config): AliasedConfig {
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
  if (!existsSync(file)) {
    return { config: defaultConfig, warnings: [], defaultAgentExplicit: false }
  }
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const defaultAgentExplicit = typeof raw === 'object' && raw !== null && 'defaultAgent' in raw
  const parsed = rawConfigSchema.parse(raw)
  const aliased = applyLegacyAliases(parsed)
  return { ...aliased, defaultAgentExplicit }
}

const writableKeys = [
  'port',
  'maxConcurrentReviews',
  'stallMinutes',
  'defaultAgent',
  'perPRGCDays',
  'language',
  'reviewExcludeGlobs',
  'diffViewMode',
] as const

export function saveConfig(file: string, config: Config): void {
  const out: Record<string, unknown> = {}
  for (const k of writableKeys) out[k] = config[k]
  // Deprecated `claudeStallMinutes` is intentionally dropped — `loadConfig`
  // already coalesces it into `stallMinutes` on read.
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
}

// Picks the agent the daemon should actually use this run when the configured
// value is missing locally. Iterates `AGENT_KINDS` in declared order (which is
// the implicit priority list). Returns `configured` unchanged when nothing is
// installed, so the existing /api/health red-banner UX still fires.
export function pickEffectiveDefaultAgent(
  configured: AgentKind,
  agentPaths: Record<AgentKind, string | null>,
): AgentKind {
  if (agentPaths[configured]) return configured
  for (const k of AGENT_KINDS) {
    if (agentPaths[k]) return k
  }
  return configured
}
