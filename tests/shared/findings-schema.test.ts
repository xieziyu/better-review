import { describe, it, expect } from 'vitest'

import { findingSchema, findingsFileSchema } from '../../src/shared/findings-schema'

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
