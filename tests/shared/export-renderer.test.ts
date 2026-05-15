import { describe, expect, it } from 'vitest'

import {
  buildExportFilename,
  renderFindingsJson,
  renderFindingsMarkdown,
  type ExportInput,
} from '../../src/shared/export-renderer'
import type { Finding } from '../../src/shared/types'

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'R1',
    dbId: 'db-1',
    sessionId: 'sess-1',
    ord: 1,
    severity: 'must',
    category: 'Correctness',
    file: 'src/foo.ts',
    line: 42,
    title: 'something is wrong',
    body: 'because of reasons',
    selected: true,
    edited: false,
    archived: false,
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function mkInput(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    pr: {
      owner: 'xieziyu',
      repo: 'better-review',
      number: 42,
      title: 'feat(export): local findings export',
      url: 'https://github.com/xieziyu/better-review/pull/42',
    },
    session: {
      roundNumber: 2,
      agent: 'claude',
      exportedAt: '2026-05-15T14:32:11.420Z',
    },
    totalFindings: 12,
    scope: 'selected',
    findings: [mkFinding()],
    ...overrides,
  }
}

describe('renderFindingsMarkdown', () => {
  it('emits a header block with PR coordinates, scope, round, agent', () => {
    const md = renderFindingsMarkdown(mkInput())
    expect(md).toContain('# Findings · xieziyu/better-review#42')
    expect(md).toContain('- **PR:** feat(export): local findings export')
    expect(md).toContain('- **URL:** https://github.com/xieziyu/better-review/pull/42')
    expect(md).toContain('- **Scope:** 1 selected of 12 (round 2)')
    expect(md).toContain('- **Agent:** claude · 2026-05-15T14:32:11.420Z')
  })

  it('omits PR title / URL header rows when those are null', () => {
    const md = renderFindingsMarkdown(
      mkInput({
        pr: {
          owner: 'a',
          repo: 'b',
          number: 1,
          title: null,
          url: null,
        },
      }),
    )
    expect(md).not.toContain('**PR:**')
    expect(md).not.toContain('**URL:**')
    expect(md).toContain('- **Scope:**')
  })

  it('uses "<n> of <total> findings" phrasing for the `all` scope', () => {
    const md = renderFindingsMarkdown(
      mkInput({ scope: 'all', findings: [mkFinding(), mkFinding({ dbId: 'db-2', ord: 2 })] }),
    )
    expect(md).toContain('- **Scope:** 2 of 12 findings (round 2)')
  })

  it('groups file-scoped findings by file and emits severity + line + category', () => {
    const md = renderFindingsMarkdown(
      mkInput({
        findings: [
          mkFinding({ file: 'src/a.ts', line: 10, dbId: 'a1', ord: 1 }),
          mkFinding({ file: 'src/a.ts', line: 20, dbId: 'a2', ord: 2, severity: 'should' }),
          mkFinding({ file: 'src/b.ts', line: 5, dbId: 'b1', ord: 3, severity: 'nit' }),
        ],
      }),
    )
    expect(md).toContain('## src/a.ts')
    expect(md).toContain('## src/b.ts')
    expect(md).toContain('### 🔴 must · L10 · Correctness')
    expect(md).toContain('### 🟡 should · L20 · Correctness')
    expect(md).toContain('### 🔵 nit · L5 · Correctness')
    // src/a.ts appears before src/b.ts because we trust caller order.
    expect(md.indexOf('## src/a.ts')).toBeLessThan(md.indexOf('## src/b.ts'))
  })

  it('renders multi-line findings with an en-dash range', () => {
    const md = renderFindingsMarkdown(
      mkInput({
        findings: [mkFinding({ line: 95, startLine: 88 })],
      }),
    )
    expect(md).toContain('### 🔴 must · L88–L95 · Correctness')
  })

  it('drops the line label when startLine equals line', () => {
    // Schema permits startLine === line (refine allows <=). Treat that
    // as a single-line finding so we don't emit "L42–L42".
    const md = renderFindingsMarkdown(
      mkInput({
        findings: [mkFinding({ line: 42, startLine: 42 })],
      }),
    )
    expect(md).toContain('### 🔴 must · L42 · Correctness')
    expect(md).not.toContain('L42–L42')
  })

  it('renders PR-wide findings under a trailing Whole PR section, without line label', () => {
    const md = renderFindingsMarkdown(
      mkInput({
        findings: [
          mkFinding({ file: 'src/a.ts', line: 10, dbId: 'a1', ord: 1 }),
          mkFinding({
            file: null,
            line: null,
            dbId: 'w1',
            ord: 2,
            severity: 'should',
            category: 'Scope',
            title: 'document the override',
          }),
        ],
      }),
    )
    expect(md).toContain('## Whole PR')
    expect(md).toContain('### 🟡 should · Scope')
    expect(md).not.toContain('L · Scope')
    // Whole PR section comes after the file sections.
    expect(md.indexOf('## src/a.ts')).toBeLessThan(md.indexOf('## Whole PR'))
  })

  it('emits the title in bold and the body verbatim', () => {
    const md = renderFindingsMarkdown(
      mkInput({
        findings: [
          mkFinding({
            title: 'null check on `finding.file`',
            body: 'When `findings` contains a PR-wide entry...\n\nSecond paragraph.',
          }),
        ],
      }),
    )
    expect(md).toContain('**null check on `finding.file`**')
    expect(md).toContain('When `findings` contains a PR-wide entry...\n\nSecond paragraph.')
  })

  it('emits a ```suggestion fence when the finding has a suggestion', () => {
    const md = renderFindingsMarkdown(
      mkInput({
        findings: [mkFinding({ suggestion: 'if (x == null) return\n' })],
      }),
    )
    expect(md).toContain('```suggestion\nif (x == null) return\n\n```')
  })

  it('widens the fence to four backticks when the suggestion contains triple backticks', () => {
    const md = renderFindingsMarkdown(
      mkInput({
        findings: [mkFinding({ suggestion: 'before\n```ts\nfix()\n```\nafter' })],
      }),
    )
    expect(md).toContain('````suggestion')
    expect(md).toMatch(/````suggestion\nbefore\n```ts\nfix\(\)\n```\nafter\n````/)
  })

  it('ends with a trailing newline', () => {
    const md = renderFindingsMarkdown(mkInput())
    expect(md.endsWith('\n')).toBe(true)
  })
})

describe('renderFindingsJson', () => {
  it('emits a schema-versioned envelope with only whitelisted finding fields', () => {
    const json = renderFindingsJson(
      mkInput({
        findings: [mkFinding({ suggestion: 'fix me' })],
      }),
    )
    const parsed = JSON.parse(json)
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.pr).toEqual({
      owner: 'xieziyu',
      repo: 'better-review',
      number: 42,
      title: 'feat(export): local findings export',
      url: 'https://github.com/xieziyu/better-review/pull/42',
    })
    expect(parsed.session).toEqual({ roundNumber: 2, agent: 'claude' })
    expect(parsed.exportedAt).toBe('2026-05-15T14:32:11.420Z')
    expect(parsed.scope).toBe('selected')
    expect(parsed.totalFindings).toBe(12)
    expect(parsed.findings).toHaveLength(1)
    expect(parsed.findings[0]).toEqual({
      severity: 'must',
      category: 'Correctness',
      file: 'src/foo.ts',
      line: 42,
      startLine: null,
      title: 'something is wrong',
      body: 'because of reasons',
      suggestion: 'fix me',
    })
    // Internal DB / agent-internal fields must not leak through.
    expect(parsed.findings[0]).not.toHaveProperty('dbId')
    expect(parsed.findings[0]).not.toHaveProperty('id')
    expect(parsed.findings[0]).not.toHaveProperty('sessionId')
    expect(parsed.findings[0]).not.toHaveProperty('ord')
    expect(parsed.findings[0]).not.toHaveProperty('selected')
    expect(parsed.findings[0]).not.toHaveProperty('edited')
    expect(parsed.findings[0]).not.toHaveProperty('archived')
    expect(parsed.findings[0]).not.toHaveProperty('createdAt')
  })

  it('normalises absent startLine / suggestion to null', () => {
    const parsed = JSON.parse(renderFindingsJson(mkInput({ findings: [mkFinding()] })))
    expect(parsed.findings[0].startLine).toBeNull()
    expect(parsed.findings[0].suggestion).toBeNull()
  })

  it('preserves caller-provided order', () => {
    const parsed = JSON.parse(
      renderFindingsJson(
        mkInput({
          findings: [
            mkFinding({ dbId: 'a', title: 'first' }),
            mkFinding({ dbId: 'b', title: 'second' }),
            mkFinding({ dbId: 'c', title: 'third' }),
          ],
        }),
      ),
    )
    expect(parsed.findings.map((f: { title: string }) => f.title)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('ends with a trailing newline', () => {
    const json = renderFindingsJson(mkInput())
    expect(json.endsWith('\n')).toBe(true)
  })
})

describe('buildExportFilename', () => {
  it('formats the canonical filename for both formats', () => {
    expect(buildExportFilename(42, 'selected', 'md')).toBe('findings-pr-42-selected.md')
    expect(buildExportFilename(42, 'all', 'json')).toBe('findings-pr-42-all.json')
  })

  it('rejects non-positive or non-integer PR numbers', () => {
    expect(() => buildExportFilename(0, 'selected', 'md')).toThrow()
    expect(() => buildExportFilename(-3, 'selected', 'md')).toThrow()
    expect(() => buildExportFilename(1.5, 'selected', 'md')).toThrow()
  })
})
