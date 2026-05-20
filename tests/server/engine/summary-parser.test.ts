import { describe, it, expect } from 'vitest'

import { parseSummary } from '../../../src/server/engine/summary-parser'

describe('parseSummary', () => {
  const valid = JSON.stringify({
    overview: 'This PR adds a summary tab.',
    manualReview: [
      { file: 'src/a.ts', reason: 'security-sensitive change' },
      { reason: 'PR-wide: check the race condition' },
    ],
  })

  it('returns ok+data for valid input', () => {
    const r = parseSummary(valid)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.overview).toMatch(/summary tab/)
      expect(r.data.manualReview).toHaveLength(2)
    }
  })

  it('defaults manualReview to an empty array when omitted', () => {
    const r = parseSummary(JSON.stringify({ overview: 'just an overview' }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.manualReview).toEqual([])
  })

  it('accepts null file (PR-wide note)', () => {
    const r = parseSummary(
      JSON.stringify({ overview: 'x', manualReview: [{ file: null, reason: 'r' }] }),
    )
    expect(r.ok).toBe(true)
  })

  it('returns error on bad JSON', () => {
    const r = parseSummary('{ broken')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/JSON/)
  })

  it('returns error when overview is missing', () => {
    const r = parseSummary(JSON.stringify({ manualReview: [] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/overview/i)
  })

  it('returns error when overview is an empty string', () => {
    const r = parseSummary(JSON.stringify({ overview: '' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/overview/i)
  })

  it('returns error when a manualReview item lacks a reason', () => {
    const r = parseSummary(JSON.stringify({ overview: 'x', manualReview: [{ file: 'a.ts' }] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/reason/i)
  })

  it('returns error on a non-object payload', () => {
    const r = parseSummary(JSON.stringify(['not', 'an', 'object']))
    expect(r.ok).toBe(false)
  })
})
