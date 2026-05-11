import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { loadConfig, defaultConfig } from '../../src/server/config'

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
  it('defaults language to "en"', () => {
    expect(defaultConfig.language).toBe('en')
    writeFileSync(join(home, 'config.json'), JSON.stringify({ port: 1 }))
    expect(loadConfig(home).language).toBe('en')
  })
  it('round-trips a zh-CN language setting', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'zh-CN' }))
    expect(loadConfig(home).language).toBe('zh-CN')
  })
  it('rejects unsupported language values', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ language: 'fr' }))
    expect(() => loadConfig(home)).toThrow()
  })
})
