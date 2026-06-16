import { describe, it, expect } from 'vitest'

import { parseFindings } from '../../../src/server/engine/findings-parser'

describe('parseFindings', () => {
  const valid = JSON.stringify([
    {
      id: 'R1',
      severity: 'must',
      category: 'Sec',
      file: 'a',
      line: 1,
      title: 't',
      body: 'b',
    },
  ])

  it('returns ok+data for valid input', () => {
    const r = parseFindings(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toHaveLength(1)
      expect(r.skipped).toHaveLength(0)
    }
  })

  it('accepts null suggestion / startLine (normalized to undefined)', () => {
    const r = parseFindings(
      JSON.stringify([
        {
          id: 'R1',
          severity: 'must',
          category: 'Correctness',
          file: 'a.ts',
          line: 10,
          startLine: null,
          title: 't',
          body: 'b',
          suggestion: null,
        },
      ]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toHaveLength(1)
      expect(r.skipped).toHaveLength(0)
      expect(r.data[0]!.suggestion).toBeUndefined()
      expect(r.data[0]!.startLine).toBeUndefined()
    }
  })

  it('keeps valid findings when a sibling entry has null suggestion', () => {
    // Regression: a single `"suggestion": null` entry used to fail the whole
    // array parse, ingesting zero findings even though the file held several.
    const r = parseFindings(
      JSON.stringify([
        { id: 'R1', severity: 'must', category: 'x', file: 'a', line: 1, title: 't', body: 'b' },
        {
          id: 'R2',
          severity: 'should',
          category: 'x',
          file: 'a',
          line: 2,
          title: 't2',
          body: 'b2',
          suggestion: null,
        },
      ]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.map((f) => f.id)).toEqual(['R1', 'R2'])
      expect(r.skipped).toHaveLength(0)
    }
  })

  it('returns error on bad JSON', () => {
    const r = parseFindings('{ broken')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/JSON/)
  })

  it('returns error on non-array', () => {
    const r = parseFindings(JSON.stringify({ id: 'R1' }))
    expect(r.ok).toBe(false)
  })

  it('skips schema-mismatched elements but keeps the array valid', () => {
    const r = parseFindings(
      JSON.stringify([
        {
          id: 'R1',
          severity: 'WAT',
          category: 'x',
          file: null,
          line: null,
          title: 't',
          body: 'b',
        },
        { id: 'R2', severity: 'must', category: 'x', file: 'a', line: 1, title: 't', body: 'b' },
      ]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.map((f) => f.id)).toEqual(['R2'])
      expect(r.skipped).toHaveLength(1)
      expect(r.skipped[0]!.index).toBe(0)
      expect(r.skipped[0]!.error).toMatch(/severity/i)
    }
  })

  it('accepts startLine when <= line', () => {
    const r = parseFindings(
      JSON.stringify([
        {
          id: 'R1',
          severity: 'must',
          category: 'Correctness',
          file: 'a.ts',
          line: 20,
          startLine: 10,
          title: 't',
          body: 'b',
        },
      ]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data[0]!.startLine).toBe(10)
  })

  it('skips startLine > line', () => {
    const r = parseFindings(
      JSON.stringify([
        {
          id: 'R1',
          severity: 'must',
          category: 'Correctness',
          file: 'a.ts',
          line: 5,
          startLine: 10,
          title: 't',
          body: 'b',
        },
      ]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toHaveLength(0)
      expect(r.skipped[0]!.error).toMatch(/startLine/i)
    }
  })

  it('skips startLine without line', () => {
    const r = parseFindings(
      JSON.stringify([
        {
          id: 'R1',
          severity: 'must',
          category: 'Correctness',
          file: 'a.ts',
          line: null,
          startLine: 5,
          title: 't',
          body: 'b',
        },
      ]),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toHaveLength(0)
      expect(r.skipped).toHaveLength(1)
    }
  })
})
