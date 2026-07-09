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
    source: 'agent',
    submittedAt: null,
    submittedCommentId: null,
    ...over,
  }
}

describe('buildSubmitPayload — source-agnostic', () => {
  it('manual finding on diff goes inline (same path as agent)', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [
        f({ source: 'manual', file: 'foo.ts', line: 11, title: 'manual on-diff' }),
        f({ source: 'agent', file: 'foo.ts', line: 11, title: 'agent on-diff' }),
      ],
      event: 'COMMENT',
      language: 'en',
    })
    expect(r.payload.comments).toHaveLength(2)
    expect(r.payload.comments.map((c) => c.body)).toEqual(
      expect.arrayContaining([expect.stringContaining('manual on-diff')]),
    )
    expect(r.payload.comments.map((c) => c.body)).toEqual(
      expect.arrayContaining([expect.stringContaining('agent on-diff')]),
    )
  })

  it('manual finding off-diff still drops to body', () => {
    const r = buildSubmitPayload({
      diff: DIFF,
      findings: [f({ source: 'manual', file: 'foo.ts', line: 999, title: 'manual off-diff' })],
      event: 'COMMENT',
      language: 'en',
    })
    expect(r.payload.comments).toHaveLength(0)
    expect(r.droppedToBody).toHaveLength(1)
    expect(r.payload.body).toContain('manual off-diff')
  })
})
