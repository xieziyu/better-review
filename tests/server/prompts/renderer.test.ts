import { describe, it, expect } from 'vitest'

import { renderPrompt } from '../../../src/server/prompts/renderer'

describe('renderPrompt', () => {
  const baseVars = {
    rules: 'RULES',
    prMeta: 'META',
    diff: 'DIFF',
    findingsPath: '/p/f.json',
    schemaJson: '{}',
  }

  it('substitutes all variables', () => {
    const tpl = 'R: {{RULES}}\nM: {{PR_META}}\nD: {{DIFF}}\nP: {{FINDINGS_PATH}}\nS: {{SCHEMA}}'
    const out = renderPrompt(tpl, baseVars)
    expect(out).toBe('R: RULES\nM: META\nD: DIFF\nP: /p/f.json\nS: {}')
  })

  it('leaves unknown placeholders alone', () => {
    expect(renderPrompt('hello {{UNKNOWN}}', baseVars)).toBe('hello {{UNKNOWN}}')
  })

  it('substitutes RULES first so legacy placeholders inside rules still get expanded', () => {
    // Old-style review.md may contain `{{DIFF}}` literally. After substitution
    // the diff text appears once from the framework slot and once from the rules
    // slot — ugly but never silently leaves a literal `{{DIFF}}` in the output.
    const tpl = 'F-DIFF: {{DIFF}} | F-RULES:\n{{RULES}}'
    const out = renderPrompt(tpl, { ...baseVars, rules: 'legacy says {{DIFF}}' })
    expect(out).toBe('F-DIFF: DIFF | F-RULES:\nlegacy says DIFF')
  })
})
