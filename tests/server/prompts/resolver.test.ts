import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { resolveEffectivePrompt, resolveEffectiveRules } from '../../../src/server/prompts/resolver'

describe('resolveEffectiveRules', () => {
  let cwd: string
  let home: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'br-cwd-'))
    home = mkdtempSync(join(tmpdir(), 'br-home-'))
  })

  it('returns English builtin rules when no overrides and lang=en', () => {
    const r = resolveEffectiveRules({ cwd, home, lang: 'en' })
    expect(r.source).toBe('builtin')
    expect(r.path).toBeNull()
    expect(r.content).toContain('Scope & Plan Alignment')
  })

  it('returns Chinese builtin rules when no overrides and lang=zh-CN', () => {
    const r = resolveEffectiveRules({ cwd, home, lang: 'zh-CN' })
    expect(r.source).toBe('builtin')
    expect(r.path).toBeNull()
    expect(r.content).toContain('范围与计划对齐')
  })

  it('global home overrides builtin regardless of language', () => {
    writeFileSync(join(home, 'review.md'), 'GLOBAL')
    expect(resolveEffectiveRules({ cwd, home, lang: 'en' })).toMatchObject({
      source: 'global',
      content: 'GLOBAL',
      path: join(home, 'review.md'),
    })
    expect(resolveEffectiveRules({ cwd, home, lang: 'zh-CN' })).toMatchObject({
      source: 'global',
      content: 'GLOBAL',
    })
  })

  it('project cwd overrides global', () => {
    writeFileSync(join(home, 'review.md'), 'GLOBAL')
    mkdirSync(join(cwd, '.better-review'))
    writeFileSync(join(cwd, '.better-review', 'review.md'), 'PROJECT')
    const r = resolveEffectiveRules({ cwd, home, lang: 'en' })
    expect(r.source).toBe('project')
    expect(r.content).toBe('PROJECT')
  })
})

describe('resolveEffectivePrompt', () => {
  let cwd: string
  let home: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'br-cwd-'))
    home = mkdtempSync(join(tmpdir(), 'br-home-'))
  })

  it('returns framework + rules + effective composition in English', () => {
    const r = resolveEffectivePrompt({ cwd, home, lang: 'en' })
    expect(r.framework).toContain('{{RULES}}')
    expect(r.framework).toContain('{{DIFF}}')
    expect(r.framework).toContain('{{FINDINGS_PATH}}')
    expect(r.rules.source).toBe('builtin')
    expect(r.effective).not.toContain('{{RULES}}')
    expect(r.effective).toContain('Scope & Plan Alignment')
  })

  it('returns framework + rules + effective composition in Chinese', () => {
    const r = resolveEffectivePrompt({ cwd, home, lang: 'zh-CN' })
    expect(r.framework).toContain('{{RULES}}')
    expect(r.framework).toContain('严重程度判定')
    expect(r.rules.source).toBe('builtin')
    expect(r.effective).toContain('范围与计划对齐')
  })

  it('substitutes user-provided rules into framework regardless of language', () => {
    writeFileSync(join(home, 'review.md'), 'CUSTOM RULE LIST')
    const r = resolveEffectivePrompt({ cwd, home, lang: 'zh-CN' })
    expect(r.rules.source).toBe('global')
    expect(r.rules.content).toBe('CUSTOM RULE LIST')
    expect(r.effective).toContain('CUSTOM RULE LIST')
    expect(r.effective).not.toContain('{{RULES}}')
    // Framework stays in the chosen language; other placeholders untouched.
    expect(r.effective).toContain('{{DIFF}}')
    expect(r.effective).toContain('严重程度判定')
  })
})
