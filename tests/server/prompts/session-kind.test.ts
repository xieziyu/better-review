// Coverage for the {{#SESSION_KIND:<kind>}}…{{/SESSION_KIND}} block
// machinery added in Phase 1c. Asserts (a) the right arm survives,
// (b) the non-matching arms are stripped entirely, and (c) when no
// sessionKind is supplied the renderer behaves as if 'github-pr' was
// passed (keeps legacy callers byte-identical).

import { describe, expect, it } from 'vitest'

import { renderPrompt } from '../../../src/server/prompts/renderer'

const baseVars = {
  rules: 'RULES',
  prMeta: 'META',
  diff: 'DIFF',
  findingsPath: '/f',
  schemaJson: '{}',
  summaryPath: '/s',
  summarySchema: 'SS',
}

const template = [
  '{{#SESSION_KIND:github-pr}}prose for github-pr{{/SESSION_KIND}}',
  '{{#SESSION_KIND:local-branch}}prose for local-branch{{/SESSION_KIND}}',
  '{{#SESSION_KIND:gitbutler-vbranch}}prose for vbranch{{/SESSION_KIND}}',
  'shared trailing text',
].join('\n')

describe('renderPrompt — SESSION_KIND blocks', () => {
  it('keeps only the matching arm for github-pr', () => {
    const out = renderPrompt(template, { ...baseVars, sessionKind: 'github-pr' })
    expect(out).toContain('prose for github-pr')
    expect(out).not.toContain('prose for local-branch')
    expect(out).not.toContain('prose for vbranch')
    expect(out).toContain('shared trailing text')
  })

  it('keeps only the matching arm for local-branch', () => {
    const out = renderPrompt(template, { ...baseVars, sessionKind: 'local-branch' })
    expect(out).toContain('prose for local-branch')
    expect(out).not.toContain('prose for github-pr')
    expect(out).not.toContain('prose for vbranch')
  })

  it('keeps only the matching arm for gitbutler-vbranch', () => {
    const out = renderPrompt(template, { ...baseVars, sessionKind: 'gitbutler-vbranch' })
    expect(out).toContain('prose for vbranch')
    expect(out).not.toContain('prose for github-pr')
    expect(out).not.toContain('prose for local-branch')
  })

  it('defaults to github-pr when sessionKind is omitted', () => {
    const out = renderPrompt(template, baseVars)
    expect(out).toContain('prose for github-pr')
    expect(out).not.toContain('prose for local-branch')
    expect(out).not.toContain('prose for vbranch')
  })

  it('does not leak SESSION_KIND markers into the output', () => {
    const out = renderPrompt(template, { ...baseVars, sessionKind: 'local-branch' })
    expect(out).not.toMatch(/\{\{#SESSION_KIND/)
    expect(out).not.toMatch(/\{\{\/SESSION_KIND\}\}/)
  })
})
