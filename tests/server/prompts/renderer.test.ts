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

  it('strips the EXTRA_NOTES block when extraNotes is undefined', () => {
    const tpl = 'A\n{{#EXTRA_NOTES}}\n## Notes\n{{EXTRA_NOTES_BODY}}\n{{/EXTRA_NOTES}}\nB'
    expect(renderPrompt(tpl, baseVars)).toBe('A\nB')
  })

  it('strips the EXTRA_NOTES block when extraNotes is whitespace only', () => {
    const tpl = 'A\n{{#EXTRA_NOTES}}\n## Notes\n{{EXTRA_NOTES_BODY}}\n{{/EXTRA_NOTES}}\nB'
    expect(renderPrompt(tpl, { ...baseVars, extraNotes: '  \n\t\n' })).toBe('A\nB')
  })

  it('keeps the EXTRA_NOTES block and substitutes the body when extraNotes is set', () => {
    const tpl = 'A\n{{#EXTRA_NOTES}}\n## Notes\n{{EXTRA_NOTES_BODY}}\n{{/EXTRA_NOTES}}\nB'
    const out = renderPrompt(tpl, { ...baseVars, extraNotes: '  see PRD section 4  ' })
    expect(out).toBe('A\n## Notes\nsee PRD section 4\nB')
  })

  it('strips the PRIOR_REVIEW block when priorReview is undefined', () => {
    const tpl = 'A\n{{#PRIOR_REVIEW}}\nprior {{LAST_REVIEWED_SHA}}\n{{/PRIOR_REVIEW}}\nB'
    expect(renderPrompt(tpl, baseVars)).toBe('A\nB')
  })

  it('renders PRIOR_REVIEW with inline comments + author reply marker', () => {
    const tpl =
      '{{#PRIOR_REVIEW}}\nsha={{LAST_REVIEWED_SHA}}\n{{#FORCE_PUSHED}}force{{/FORCE_PUSHED}}{{^FORCE_PUSHED}}clean{{/FORCE_PUSHED}}\nbody={{PRIOR_REVIEW_BODY}}\ninline:\n{{PRIOR_REVIEW_INLINE}}\nissue:\n{{PRIOR_REVIEW_ISSUE}}\n{{/PRIOR_REVIEW}}'
    const out = renderPrompt(tpl, {
      ...baseVars,
      priorReview: {
        lastReviewedSha: 'abc1234',
        forcePushed: false,
        reviewBody: 'overall',
        inlineComments: [
          {
            file: 'a.ts',
            line: 12,
            startLine: null,
            body: 'inline body',
            replies: [
              { author: 'alice', body: '不打算改，因为 X', isAuthor: true },
              { author: 'bob', body: 'agree', isAuthor: false },
            ],
          },
        ],
        issueComments: [{ author: 'alice', body: '已修', isAuthor: true }],
      },
    })
    expect(out).toContain('sha=abc1234')
    expect(out).toContain('clean')
    expect(out).not.toContain('force')
    expect(out).toContain('a.ts:12')
    expect(out).toContain('**@alice（作者）**')
    expect(out).toContain('不打算改，因为 X')
    expect(out).toContain('@bob')
    expect(out).toContain('已修')
  })

  it('shows the force-pushed banner when forcePushed=true', () => {
    const tpl =
      '{{#PRIOR_REVIEW}}{{#FORCE_PUSHED}}FORCE{{/FORCE_PUSHED}}{{^FORCE_PUSHED}}CLEAN{{/FORCE_PUSHED}}{{/PRIOR_REVIEW}}'
    const out = renderPrompt(tpl, {
      ...baseVars,
      priorReview: {
        lastReviewedSha: 'abc1234',
        forcePushed: true,
        reviewBody: '',
        inlineComments: [],
        issueComments: [],
      },
    })
    expect(out).toContain('FORCE')
    expect(out).not.toContain('CLEAN')
  })
})
