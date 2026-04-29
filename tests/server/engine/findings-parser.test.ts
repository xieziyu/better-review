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
    if (r.ok) expect(r.data).toHaveLength(1)
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

  it('returns error on schema mismatch', () => {
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
      ]),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/severity/i)
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

  it('rejects startLine > line', () => {
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
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/startLine/i)
  })

  it('rejects startLine without line', () => {
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
    expect(r.ok).toBe(false)
  })
})
