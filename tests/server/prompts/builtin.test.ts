import { describe, it, expect } from 'vitest'

import { getBuiltinRules, getFramework } from '../../../src/server/prompts/builtin'

describe('builtin prompt assets', () => {
  it('framework contains all five placeholders and the suggestion guidance', () => {
    const f = getFramework()
    expect(f).toContain('{{RULES}}')
    expect(f).toContain('{{PR_META}}')
    expect(f).toContain('{{DIFF}}')
    expect(f).toContain('{{FINDINGS_PATH}}')
    expect(f).toContain('{{SCHEMA}}')
    expect(f).toContain('How to use `suggestion`')
    expect(f).toContain('Severity rubric')
  })

  it('builtin rules cover the default review categories', () => {
    const r = getBuiltinRules()
    expect(r).toContain('Scope & Plan Alignment')
    expect(r).toContain('Correctness & Type Safety')
    expect(r).toContain('Security')
    expect(r).toContain('Architecture & Design')
    expect(r).toContain('Performance')
    expect(r).toContain('Naming & Readability')
    expect(r).toContain('Complexity')
    expect(r).toContain('Error Handling')
    expect(r).toContain('Category labels')
    // Rules must NOT contain workflow placeholders — those live in framework.
    expect(r).not.toContain('{{DIFF}}')
    expect(r).not.toContain('{{FINDINGS_PATH}}')
  })

  it('caches results across calls', () => {
    expect(getFramework()).toBe(getFramework())
    expect(getBuiltinRules()).toBe(getBuiltinRules())
  })
})
