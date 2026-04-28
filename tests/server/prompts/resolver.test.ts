import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, beforeEach } from 'vitest'

import { resolveEffectivePrompt } from '../../../src/server/prompts/resolver'

describe('resolveEffectivePrompt', () => {
  let cwd: string
  let home: string
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'br-cwd-'))
    home = mkdtempSync(join(tmpdir(), 'br-home-'))
  })

  it('returns builtin when no overrides', () => {
    const r = resolveEffectivePrompt({ cwd, home })
    expect(r.source).toBe('builtin')
    expect(r.content).toContain('{{DIFF}}')
  })

  it('global home overrides builtin', () => {
    writeFileSync(join(home, 'review.md'), 'GLOBAL')
    const r = resolveEffectivePrompt({ cwd, home })
    expect(r.source).toBe('global')
    expect(r.content).toBe('GLOBAL')
  })

  it('project cwd overrides global', () => {
    writeFileSync(join(home, 'review.md'), 'GLOBAL')
    mkdirSync(join(cwd, '.better-review'))
    writeFileSync(join(cwd, '.better-review', 'review.md'), 'PROJECT')
    const r = resolveEffectivePrompt({ cwd, home })
    expect(r.source).toBe('project')
    expect(r.content).toBe('PROJECT')
  })
})
