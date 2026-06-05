import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  defaultConfig,
  detectSystemLanguage,
  loadConfig,
  loadConfigWithWarnings,
  pickEffectiveDefaultAgent,
} from '../../src/server/config'
import type { AgentKind } from '../../src/shared/types'

describe('loadConfig', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'br-cfg-'))
  })
  it('returns defaults when file missing', () => {
    expect(loadConfig(home)).toEqual(defaultConfig)
  })
  it('merges user overrides', () => {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ port: 8765, maxConcurrentReviews: 2 }),
    )
    const c = loadConfig(home)
    expect(c.port).toBe(8765)
    expect(c.maxConcurrentReviews).toBe(2)
  })
  it('rejects unknown keys silently (strips)', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ foo: 1, port: 1234 }))
    const c = loadConfig(home)
    expect((c as Record<string, unknown>).foo).toBeUndefined()
    expect(c.port).toBe(1234)
  })
  it('falls back to a supported language when the field is missing', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ port: 1 }))
    expect(['en', 'zh-CN']).toContain(loadConfig(home).language)
  })
  it('defaults reviewExcludeGlobs to an empty array when the field is missing', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ port: 1 }))
    expect(loadConfig(home).reviewExcludeGlobs).toEqual([])
  })
  it('round-trips custom reviewExcludeGlobs entries', () => {
    writeFileSync(
      join(home, 'config.json'),
      JSON.stringify({ reviewExcludeGlobs: ['*.generated.ts', 'docs/api/**'] }),
    )
    expect(loadConfig(home).reviewExcludeGlobs).toEqual(['*.generated.ts', 'docs/api/**'])
  })
  it('defaults diffViewMode to unified when the field is missing', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ port: 1 }))
    expect(loadConfig(home).diffViewMode).toBe('unified')
  })
  it('round-trips a split diffViewMode setting', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ diffViewMode: 'split' }))
    expect(loadConfig(home).diffViewMode).toBe('split')
  })
  it('round-trips a zh-CN language setting', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'zh-CN' }))
    expect(loadConfig(home).language).toBe('zh-CN')
  })
  it('round-trips an explicit en language setting', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en' }))
    expect(loadConfig(home).language).toBe('en')
  })
  it('rejects unsupported language values', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'fr' }))
    expect(() => loadConfig(home)).toThrow()
  })
})

describe('detectSystemLanguage', () => {
  const envKeys = ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const
  let saved: Record<string, string | undefined>
  beforeEach(() => {
    saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]))
    for (const k of envKeys) delete process.env[k]
  })
  afterEach(() => {
    for (const k of envKeys) {
      const v = saved[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })
  it('maps zh_* locales to zh-CN', () => {
    process.env.LANG = 'zh_CN.UTF-8'
    expect(detectSystemLanguage()).toBe('zh-CN')
  })
  it('maps non-Chinese locales to en', () => {
    process.env.LANG = 'en_US.UTF-8'
    expect(detectSystemLanguage()).toBe('en')
  })
  it('prefers LC_ALL over LANG', () => {
    process.env.LC_ALL = 'zh_CN.UTF-8'
    process.env.LANG = 'en_US.UTF-8'
    expect(detectSystemLanguage()).toBe('zh-CN')
  })
})

describe('loadConfigWithWarnings — defaultAgentExplicit', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'br-cfg-explicit-'))
  })
  it('is false when config.json is missing', () => {
    expect(loadConfigWithWarnings(home).defaultAgentExplicit).toBe(false)
  })
  it('is false when config.json omits defaultAgent', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'en' }))
    expect(loadConfigWithWarnings(home).defaultAgentExplicit).toBe(false)
  })
  it('is true when config.json sets defaultAgent', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultAgent: 'claude' }))
    const r = loadConfigWithWarnings(home)
    expect(r.defaultAgentExplicit).toBe(true)
    expect(r.config.defaultAgent).toBe('claude')
  })
})

describe('pickEffectiveDefaultAgent', () => {
  const paths = (
    overrides: Partial<Record<AgentKind, string | null>>,
  ): Record<AgentKind, string | null> => ({
    codex: null,
    claude: null,
    pi: null,
    ...overrides,
  })

  it('keeps the configured agent when its CLI is installed', () => {
    expect(pickEffectiveDefaultAgent('codex', paths({ codex: '/usr/bin/codex' }))).toBe('codex')
  })
  it('falls back through AGENT_KINDS order when configured is missing', () => {
    // configured=pi missing; claude installed; codex missing → 'claude'.
    expect(pickEffectiveDefaultAgent('pi', paths({ claude: '/usr/bin/claude' }))).toBe('claude')
  })
  it('prefers earlier AGENT_KINDS entries even when later ones are also available', () => {
    // codex and claude both installed; configured=pi → 'codex' (priority, not first non-configured).
    expect(
      pickEffectiveDefaultAgent(
        'pi',
        paths({ codex: '/usr/bin/codex', claude: '/usr/bin/claude' }),
      ),
    ).toBe('codex')
  })
  it('returns the configured value unchanged when nothing is installed', () => {
    expect(pickEffectiveDefaultAgent('claude', paths({}))).toBe('claude')
  })
})
