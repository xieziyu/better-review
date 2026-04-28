import { describe, it, expect } from 'vitest'

import { buildSubmitPayload } from '../../../src/server/engine/payload-builder'
import type { Finding } from '../../../src/shared/types'

const DIFF = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -10,1 +10,2 @@
 a
+b
`

function f(over: Partial<Finding>): Finding {
  return {
    dbId: 'x',
    sessionId: 's',
    id: 'R1',
    ord: 1,
    severity: 'must',
    category: 'x',
    file: null,
    line: null,
    title: 't',
    body: 'body text',
    selected: true,
    edited: false,
    archived: false,
    createdAt: 1,
    ...over,
  }
}

describe('buildSubmitPayload', () => {
  it('inline finding becomes comment', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ file: 'foo.ts', line: 11 })],
      event: 'COMMENT',
    })
    expect(r.payload.comments).toHaveLength(1)
    expect(r.payload.comments[0]).toMatchObject({ path: 'foo.ts', line: 11, side: 'RIGHT' })
    expect(r.droppedToBody).toHaveLength(0)
  })

  it('file=null finding goes to body', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ id: 'R1', file: null, line: null })],
      event: 'COMMENT',
    })
    expect(r.payload.comments).toHaveLength(0)
    expect(r.payload.body).toContain('body text')
  })

  it('line outside diff drops to body', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ file: 'foo.ts', line: 999 })],
      event: 'COMMENT',
    })
    expect(r.payload.comments).toHaveLength(0)
    expect(r.droppedToBody).toHaveLength(1)
    expect(r.payload.body).toContain('foo.ts')
  })

  it('includes user-provided body prefix', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [],
      event: 'APPROVE',
      userBody: 'LGTM!',
    })
    expect(r.payload.body).toContain('LGTM!')
    expect(r.payload.event).toBe('APPROVE')
  })

  it('includes suggestion block in inline comment', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ file: 'foo.ts', line: 11, suggestion: 'fixed' })],
      event: 'COMMENT',
    })
    expect(r.payload.comments[0]!.body).toContain('```suggestion')
    expect(r.payload.comments[0]!.body).toContain('fixed')
  })
})
