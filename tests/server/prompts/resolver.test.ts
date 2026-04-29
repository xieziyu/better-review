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

  it('returns builtin rules when no overrides', () => {
    const r = resolveEffectiveRules({ cwd, home })
    expect(r.source).toBe('builtin')
    expect(r.path).toBeNull()
    expect(r.content).toContain('Scope & Plan Alignment')
  })

  it('global home overrides builtin', () => {
    writeFileSync(join(home, 'review.md'), 'GLOBAL')
    const r = resolveEffectiveRules({ cwd, home })
    expect(r.source).toBe('global')
    expect(r.content).toBe('GLOBAL')
    expect(r.path).toBe(join(home, 'review.md'))
  })

  it('project cwd overrides global', () => {
    writeFileSync(join(home, 'review.md'), 'GLOBAL')
    mkdirSync(join(cwd, '.better-review'))
    writeFileSync(join(cwd, '.better-review', 'review.md'), 'PROJECT')
    const r = resolveEffectiveRules({ cwd, home })
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

  it('returns framework + rules + effective composition', () => {
    const r = resolveEffectivePrompt({ cwd, home })
    expect(r.framework).toContain('{{RULES}}')
    expect(r.framework).toContain('{{DIFF}}')
    expect(r.framework).toContain('{{FINDINGS_PATH}}')
    expect(r.rules.source).toBe('builtin')
    expect(r.effective).not.toContain('{{RULES}}')
    expect(r.effective).toContain('Scope & Plan Alignment')
  })

  it('substitutes user-provided rules into framework', () => {
    writeFileSync(join(home, 'review.md'), 'CUSTOM RULE LIST')
    const r = resolveEffectivePrompt({ cwd, home })
    expect(r.rules.source).toBe('global')
    expect(r.rules.content).toBe('CUSTOM RULE LIST')
    expect(r.effective).toContain('CUSTOM RULE LIST')
    expect(r.effective).not.toContain('{{RULES}}')
    // Other placeholders are untouched (they get filled by the renderer later).
    expect(r.effective).toContain('{{DIFF}}')
  })
})
