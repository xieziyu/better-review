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

  it('strips both source blocks when sourceKind is none/unset', () => {
    const tpl =
      'A\n{{#SOURCE:worktree}}\nworktree at {{SOURCE_PATH}}\n{{/SOURCE}}\n{{#SOURCE:snapshot}}\nsnapshot at {{SOURCE_PATH}}\n{{/SOURCE}}\nB'
    expect(renderPrompt(tpl, baseVars)).toBe('A\nB')
    expect(renderPrompt(tpl, { ...baseVars, sourceKind: 'none' })).toBe('A\nB')
  })

  it('keeps the worktree block (substituting {{SOURCE_PATH}} and {{HEAD_SHA}}) and drops snapshot when kind=worktree', () => {
    const tpl =
      'A\n{{#SOURCE:worktree}}\nworktree at {{SOURCE_PATH}} ({{HEAD_SHA}})\n{{/SOURCE}}\n{{#SOURCE:snapshot}}\nsnapshot at {{SOURCE_PATH}}\n{{/SOURCE}}\nB'
    const out = renderPrompt(tpl, {
      ...baseVars,
      sourceKind: 'worktree',
      sourcePath: '/Users/me/code/x/repo',
      headSha: 'abc123',
    })
    expect(out).toBe('A\nworktree at /Users/me/code/x/repo (abc123)\nB')
  })

  it('keeps the snapshot block and drops worktree when kind=snapshot', () => {
    const tpl =
      'A\n{{#SOURCE:worktree}}\nworktree at {{SOURCE_PATH}}\n{{/SOURCE}}\n{{#SOURCE:snapshot}}\nsnapshot at {{SOURCE_PATH}}\n{{/SOURCE}}\nB'
    const out = renderPrompt(tpl, {
      ...baseVars,
      sourceKind: 'snapshot',
      sourcePath: '/sess/source',
    })
    expect(out).toBe('A\nsnapshot at /sess/source\nB')
  })
})
