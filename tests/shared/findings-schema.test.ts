import { describe, it, expect } from 'vitest'

import {
  findingSchema,
  findingsFileSchema,
  manualFindingInputSchema,
} from '../../src/shared/findings-schema'

describe('findingSchema', () => {
  const valid = {
    id: 'R1',
    severity: 'must',
    category: 'Security',
    file: 'src/x.ts',
    line: 10,
    title: 't',
    body: 'b',
  }
  it('accepts valid finding', () => {
    expect(findingSchema.parse(valid)).toMatchObject(valid)
  })
  it('rejects bad severity', () => {
    expect(() => findingSchema.parse({ ...valid, severity: 'wat' })).toThrow()
  })
  it('allows null file/line for review-body finding', () => {
    expect(findingSchema.parse({ ...valid, file: null, line: null })).toBeTruthy()
  })
  it('findingsFileSchema parses array', () => {
    expect(findingsFileSchema.parse([valid])).toHaveLength(1)
  })
})

describe('manualFindingInputSchema', () => {
  const base = {
    severity: 'should',
    category: 'Correctness',
    file: 'src/x.ts',
    title: 't',
    body: 'b',
  } as const
  it('accepts a file-level finding without line and without suggestion', () => {
    expect(manualFindingInputSchema.parse(base)).toMatchObject(base)
  })
  it('accepts a line-anchored finding with suggestion', () => {
    expect(
      manualFindingInputSchema.parse({ ...base, line: 12, suggestion: 'fixed = 1' }),
    ).toMatchObject({ suggestion: 'fixed = 1' })
  })
  it('rejects a file-level finding that carries a suggestion', () => {
    // The fenced suggestion block isn't actionable when the finding lands
    // in the review body, so file-level + suggestion is invalid by design.
    const r = manualFindingInputSchema.safeParse({ ...base, suggestion: 'fixed = 1' })
    expect(r.success).toBe(false)
  })
})
