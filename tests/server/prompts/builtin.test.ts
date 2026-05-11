import { describe, it, expect } from 'vitest'

import { getBuiltinRules, getFramework } from '../../../src/server/prompts/builtin'

describe('builtin prompt assets', () => {
  it('English framework contains all five placeholders and the suggestion guidance', () => {
    const f = getFramework('en')
    expect(f).toContain('{{RULES}}')
    expect(f).toContain('{{PR_META}}')
    expect(f).toContain('{{DIFF}}')
    expect(f).toContain('{{FINDINGS_PATH}}')
    expect(f).toContain('{{SCHEMA}}')
    expect(f).toContain('How to use `suggestion`')
    expect(f).toContain('Severity rubric')
  })

  it('Chinese framework keeps the same placeholders', () => {
    const f = getFramework('zh-CN')
    expect(f).toContain('{{RULES}}')
    expect(f).toContain('{{PR_META}}')
    expect(f).toContain('{{DIFF}}')
    expect(f).toContain('{{FINDINGS_PATH}}')
    expect(f).toContain('{{SCHEMA}}')
    expect(f).toContain('严重程度判定')
    expect(f).toContain('如何使用 `suggestion`')
  })

  it('English builtin rules cover the default review categories', () => {
    const r = getBuiltinRules('en')
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

  it('Chinese builtin rules keep English category strings as data values', () => {
    const r = getBuiltinRules('zh-CN')
    expect(r).toContain('范围与计划对齐')
    expect(r).toContain('正确性与类型安全')
    expect(r).toContain('安全')
    // Category labels are data, not prose — they must stay in English.
    expect(r).toContain('`Scope`')
    expect(r).toContain('`Correctness`')
    expect(r).toContain('`Type Safety`')
    expect(r).not.toContain('{{DIFF}}')
  })

  it('caches results per language', () => {
    expect(getFramework('en')).toBe(getFramework('en'))
    expect(getFramework('zh-CN')).toBe(getFramework('zh-CN'))
    expect(getBuiltinRules('en')).toBe(getBuiltinRules('en'))
    expect(getBuiltinRules('zh-CN')).toBe(getBuiltinRules('zh-CN'))
    expect(getFramework('en')).not.toBe(getFramework('zh-CN'))
  })
})
